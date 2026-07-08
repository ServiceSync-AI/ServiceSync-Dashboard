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
import type { _Object } from '@aws-sdk/client-s3';
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
  /** The UTC day analyzed (YYYY-MM-DD) when date-scoped, else null = most-recent mode. */
  day: string | null;
}

const MAX_TRANSCRIPTS = 12; // bound cost/latency of the model pass
// Over-fetch pool for most-recent mode: the live drive produces many short
// test/ambient clips, so grabbing exactly the newest 12 gets crowded out by junk
// and the page reads empty. We pull a wider pool, filter, then keep the newest 12
// real conversations.
const RECENT_POOL = 60;
// A single busy day can hold many recordings — cap the day-scoped pass so a heavy
// day can't blow up model cost/latency (newest-first, so we keep the latest work).
const DAY_MAX_TRANSCRIPTS = 40;
const MIN_WORDS = 15; // hard floor: skip empty/near-silent transcripts (e.g. ". .")
// Ambient floor: transcripts above MIN_WORDS but below this are almost always
// desk noise / a mic left open, not a service-advisor conversation. Kept low so a
// genuinely brief exchange isn't dropped.
const SIGNAL_MIN_WORDS = 25;
const CACHE_TTL_MS = 30 * 60_000; // 30 min — recovery data doesn't change fast

// Filenames that betray a test rig or non-work capture. Conservative on purpose:
// only strong signals, so a real conversation is never dropped by its name.
const JUNK_KEY_RE = /(?:test|gaming|sample|demo|ambient|mic[-_ ]?check|silence)/i;

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

/** UTC calendar day (YYYY-MM-DD) of an S3 object's LastModified. */
function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True when a key looks like a test/ambient rig rather than a real capture. */
function looksLikeJunkKey(key: string): boolean {
  const name = key.split('/').pop() ?? key;
  return JUNK_KEY_RE.test(name);
}

/**
 * True when transcript text carries enough signal to be a real conversation.
 * Drops empties (< MIN_WORDS) and ambient/noise clips (< SIGNAL_MIN_WORDS), plus
 * degenerate clips that are one token repeated (e.g. "test test test").
 */
function hasSignal(text: string): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < MIN_WORDS || words.length < SIGNAL_MIN_WORDS) return false;
  const unique = new Set(words.map((w) => w.toLowerCase())).size;
  return unique >= 12;
}

/**
 * Load transcripts for the model pass, filtering junk before analysis.
 *
 * Two selection modes:
 *   - day (YYYY-MM-DD): every transcript whose S3 LastModified falls on that UTC
 *     day (mirrors the audit lambda), newest first, capped at DAY_MAX_TRANSCRIPTS.
 *   - default: the most-recent real conversations — pulled from a wider pool so
 *     the flood of short test/ambient clips can't crowd them out (the old bug).
 *
 * Junk is dropped in two cheap passes: by filename (test/gaming/ambient) before
 * we spend an S3 read, then by content signal after reading.
 */
async function loadTranscripts(
  prefix: string,
  opts: { day?: string } = {},
): Promise<{ id: string; text: string }[]> {
  const { day } = opts;
  const jsons = (await listAll(config.audioBucket, prefix))
    .filter((o) => o.Key && /\.json$/i.test(o.Key))
    // Drop obvious test/ambient rigs by name before spending reads on them.
    .filter((o) => !looksLikeJunkKey(o.Key!));

  const byNewest = (a: _Object, b: _Object) =>
    (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0);

  const candidates: _Object[] = day
    ? jsons
        .filter((o) => o.LastModified && utcDay(o.LastModified) === day)
        .sort(byNewest)
        .slice(0, DAY_MAX_TRANSCRIPTS)
    : jsons.sort(byNewest).slice(0, RECENT_POOL);

  const loaded: { id: string; text: string; at: number }[] = [];
  await Promise.all(
    candidates.map(async (o) => {
      try {
        const text = transcriptText(await getObjectText(config.audioBucket, o.Key!));
        if (!hasSignal(text)) return;
        const id = (o.Key!.split('/').pop() ?? o.Key!).replace(/\.json$/i, '');
        loaded.push({ id, text, at: o.LastModified?.getTime() ?? 0 });
      } catch {
        /* skip unreadable transcript */
      }
    }),
  );

  // Newest first, then bound the number of model calls.
  loaded.sort((a, b) => b.at - a.at);
  return loaded.slice(0, MAX_TRANSCRIPTS).map(({ id, text }) => ({ id, text }));
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

/** Run the Claude pass over the selected transcripts and aggregate. */
async function detectDeclinedWork(advisorId?: string, day?: string): Promise<RecoveryResult> {
  const transcripts = await loadTranscripts(transcriptsPrefixForAdvisor(advisorId), { day });
  const generatedAt = new Date().toISOString();
  const dayLabel = day ?? null;
  if (transcripts.length === 0) {
    return {
      items: [],
      totalDollars: 0,
      transcriptsScanned: 0,
      model: MODEL_LABEL,
      generatedAt,
      day: dayLabel,
    };
  }

  const items: DeclinedItem[] = [];
  let successes = 0;
  let failures = 0;
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
        successes++;
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
        failures++;
      }
    }),
  );

  // If every transcript analysis failed (e.g. Bedrock access not granted /
  // throttled), surface that as an error rather than a misleading "no declined
  // work" — the page renders the "analysis unavailable" card instead.
  if (successes === 0 && failures > 0) {
    throw new Error(`declined-work analysis failed on all ${failures} transcript(s) — Bedrock unavailable?`);
  }

  // Surface safety items first, then by dollar value.
  items.sort((a, b) => {
    if ((a.urgency === 'safety') !== (b.urgency === 'safety')) return a.urgency === 'safety' ? -1 : 1;
    return (b.estDollars ?? 0) - (a.estDollars ?? 0);
  });

  const totalDollars = items.reduce((s, i) => s + (i.estDollars ?? 0), 0);
  return {
    items,
    totalDollars,
    transcriptsScanned: transcripts.length,
    model: MODEL_LABEL,
    generatedAt,
    day: dayLabel,
  };
}

const MODEL_LABEL = 'claude-sonnet-4-6 (Bedrock)';

/**
 * Cached entry point. Returns the last result within the TTL to avoid
 * re-billing the model on every page load; pass force=true to recompute.
 *
 * `advisorId` scopes the transcript source (best-effort — see
 * transcriptsPrefixForAdvisor) and keys the cache so switching advisors never
 * serves another advisor's cached result. Omitting it preserves the original
 * single-advisor behavior (config.advisorId).
 *
 * `day` (YYYY-MM-DD) scopes the pass to a specific UTC day; omit it for the
 * default most-recent behavior. The day is part of the cache key so switching
 * dates never serves the wrong day's result.
 */
export async function getRecovery(
  advisorId?: string,
  day?: string,
  force = false,
): Promise<RecoveryResult> {
  const advisor = advisorId?.trim() || config.advisorId;
  const dayKey = day?.trim() || '';
  const key = `${advisor}::${dayKey || 'recent'}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.result;
  }
  const result = await detectDeclinedWork(advisor, dayKey || undefined);
  cache.set(key, { at: Date.now(), result });
  return result;
}
