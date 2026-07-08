/**
 * Declined Work Recovery — Pilot Intelligence Dashboard
 * =====================================================
 * The core ServiceSync product signal: from service-advisor audio transcripts,
 * find recommended work the customer DECLINED or DEFERRED today, estimate the
 * dollars left on the table, and flag whether a follow-up was logged.
 *
 * This upgrades the keyword heuristic in lib/analyze.ts (the "Declined work"
 * highlight group) to a Claude (Bedrock) pass that extracts structured items
 * with the customer's own words. Results are cached in-memory with a TTL so a
 * page refresh doesn't re-bill the model on every load.
 */
import { listAll, getObjectText } from './s3';
import { config } from './config';
import { invokeClaude, parseJsonBlock } from './bedrock';

export type Urgency = 'safety' | 'maintenance' | 'cosmetic' | 'unknown';

export interface DeclinedItem {
  vehicle: string | null;
  customer: string | null;
  declinedItem: string;
  estDollars: number | null;
  urgency: Urgency;
  followUpLogged: boolean;
  quote: string;
  transcriptId: string;
}

export interface RecoveryResult {
  items: DeclinedItem[];
  totalDollars: number;
  transcriptsScanned: number;
  model: string;
  generatedAt: string;
}

const MAX_TRANSCRIPTS = 12; // bound cost/latency of the model pass
const MIN_WORDS = 15; // skip empty/near-silent transcripts (e.g. ". .")
const CACHE_TTL_MS = 30 * 60_000; // 30 min — recovery data doesn't change fast

// Cache keyed by advisor so switching the selector doesn't serve stale results
// from another advisor. Default (no advisor) uses the config.advisorId key.
const cache = new Map<string, { at: number; result: RecoveryResult }>();

/**
 * Resolve the S3 transcript prefix for a given advisor.
 *
 * Multi-advisor seam (best-effort): the live pilot stores ALL transcripts under
 * a single `config.transcriptsPrefix`, so today every advisor maps to that same
 * prefix — behavior is unchanged. Once transcripts are written under a
 * per-advisor prefix, switch on `advisorId` here and the rest of the recovery
 * pipeline scopes automatically.
 * TODO(multi-advisor): return a per-advisor prefix (e.g. `${advisorId}/transcripts/`)
 * once the capture pipeline partitions transcripts by advisor.
 */
export function transcriptsPrefixForAdvisor(_advisorId?: string): string {
  return config.transcriptsPrefix;
}

/**
 * Pull transcript text from either the Whisper Lambda shape ({ transcript })
 * or raw AWS Transcribe JSON (results.transcripts[0].transcript). The live
 * pilot files are the Whisper shape; the fallback keeps this robust if the
 * source ever changes.
 */
export function transcriptText(raw: string): string {
  try {
    const j = JSON.parse(raw);
    if (typeof j.transcript === 'string') return j.transcript;
    const t = j?.results?.transcripts?.[0]?.transcript;
    if (typeof t === 'string') return t;
  } catch {
    /* not JSON — fall through */
  }
  return '';
}

async function loadRecentTranscripts(prefix: string, limit = MAX_TRANSCRIPTS) {
  const objs = await listAll(config.audioBucket, prefix);
  const recent = objs
    .filter((o) => o.Key && /\.json$/i.test(o.Key))
    .sort(
      (a, b) =>
        (b.LastModified ?? new Date(0)).getTime() -
        (a.LastModified ?? new Date(0)).getTime(),
    )
    .slice(0, limit);

  const out: { id: string; text: string }[] = [];
  await Promise.all(
    recent.map(async (o) => {
      try {
        const text = transcriptText(await getObjectText(config.audioBucket, o.Key!));
        if (text.trim().split(/\s+/).length >= MIN_WORDS) {
          const id = (o.Key!.split('/').pop() ?? o.Key!).replace(/\.json$/i, '');
          out.push({ id, text });
        }
      } catch {
        /* skip unreadable transcript */
      }
    }),
  );
  return out;
}

const SYSTEM_PROMPT = `You are a service-drive analyst for an automotive dealership. You read raw service-advisor conversation transcripts (which may be messy, multi-speaker, and lack punctuation) and identify DECLINED or DEFERRED work: any recommended service or repair the customer did NOT approve today.

For each distinct declined/deferred item, extract:
- "vehicle": the vehicle (year/make/model or however it's referenced), or null if not stated
- "customer": the customer's name if stated, else null
- "declined_item": a short description of the recommended work that was declined/deferred (e.g. "Front brake pads and rotors")
- "est_dollars": your best numeric estimate of the dollar value if a price/estimate is mentioned or clearly implied; otherwise null (no guessing wild numbers)
- "urgency": one of "safety" (brakes, tires, steering, etc.), "maintenance" (fluids, filters, scheduled service), "cosmetic", or "unknown"
- "follow_up_logged": true ONLY if the advisor clearly states they will follow up / call back / schedule a reminder; otherwise false
- "quote": a short verbatim snippet from the transcript showing the decline (the customer's or advisor's words)

Rules:
- Only include work that was RECOMMENDED and then declined/deferred/postponed. Do NOT include work that was approved or performed.
- If nothing was declined, return an empty array.
- Return ONLY a JSON array, no prose, no markdown fences.`;

/** Run the Claude pass over the recent transcripts and aggregate. */
async function detectDeclinedWork(advisorId?: string): Promise<RecoveryResult> {
  const transcripts = await loadRecentTranscripts(transcriptsPrefixForAdvisor(advisorId));
  const generatedAt = new Date().toISOString();
  if (transcripts.length === 0) {
    return { items: [], totalDollars: 0, transcriptsScanned: 0, model: MODEL_LABEL, generatedAt };
  }

  const items: DeclinedItem[] = [];
  // One call per transcript keeps prompts small and maps quotes → source cleanly.
  await Promise.all(
    transcripts.map(async (t) => {
      try {
        const reply = await invokeClaude({
          system: SYSTEM_PROMPT,
          user: `Transcript id: ${t.id}\n\nTranscript:\n"""${t.text.slice(0, 12000)}"""`,
          model: 'sonnet',
          maxTokens: 1200,
        });
        const parsed = parseJsonBlock<Array<Record<string, unknown>>>(reply) ?? [];
        for (const r of parsed) {
          if (!r || typeof r.declined_item !== 'string' || !r.declined_item.trim()) continue;
          const urgency = r.urgency;
          items.push({
            vehicle: typeof r.vehicle === 'string' ? r.vehicle : null,
            customer: typeof r.customer === 'string' ? r.customer : null,
            declinedItem: r.declined_item.trim(),
            estDollars: typeof r.est_dollars === 'number' && isFinite(r.est_dollars) ? r.est_dollars : null,
            urgency: urgency === 'safety' || urgency === 'maintenance' || urgency === 'cosmetic' ? urgency : 'unknown',
            followUpLogged: r.follow_up_logged === true,
            quote: typeof r.quote === 'string' ? r.quote : '',
            transcriptId: t.id,
          });
        }
      } catch {
        /* skip transcript the model pass failed on */
      }
    }),
  );

  // Surface safety items first, then by dollar value.
  items.sort((a, b) => {
    if ((a.urgency === 'safety') !== (b.urgency === 'safety')) return a.urgency === 'safety' ? -1 : 1;
    return (b.estDollars ?? 0) - (a.estDollars ?? 0);
  });

  const totalDollars = items.reduce((s, i) => s + (i.estDollars ?? 0), 0);
  return { items, totalDollars, transcriptsScanned: transcripts.length, model: MODEL_LABEL, generatedAt };
}

const MODEL_LABEL = 'claude-sonnet-5 (Bedrock)';

/**
 * Cached entry point. Returns the last result within the TTL to avoid
 * re-billing the model on every page load; pass force=true to recompute.
 *
 * `advisorId` scopes the transcript source (best-effort — see
 * transcriptsPrefixForAdvisor) and keys the cache so switching advisors never
 * serves another advisor's cached result. Omitting it preserves the original
 * single-advisor behavior (config.advisorId).
 */
export async function getRecovery(advisorId?: string, force = false): Promise<RecoveryResult> {
  const key = advisorId?.trim() || config.advisorId;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.result;
  }
  const result = await detectDeclinedWork(key);
  cache.set(key, { at: Date.now(), result });
  return result;
}
