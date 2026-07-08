/**
 * Recovery (/intel/recovery) — Declined Work Recovery
 * ===================================================
 * The flagship ServiceSync signal: a Claude (Bedrock) pass over recent advisor
 * transcripts, surfacing recommended work the customer declined/deferred, the
 * estimated dollars on the table, and whether a follow-up was logged. Items with
 * no logged follow-up are the recoverable opportunity.
 *
 * Server-rendered; the model pass is cached in-memory (see lib/recovery.ts) so a
 * refresh doesn't re-bill the model. Requires the dashboard's AWS identity to
 * hold bedrock:InvokeModel on the Claude profiles.
 */
import { cookies } from 'next/headers';
import { getRecovery, type DeclinedItem, type RecoveryResult } from '@/lib/recovery';
import { listOutreach, type OutreachRecord } from '@/lib/outreach';
import { smsSendEnabled } from '@/lib/sms';
import { resolveAdvisorId } from '@/lib/advisors';
import { clockUTC, relativeTime } from '@/lib/format';
import RecoveryDatePicker from '@/components/RecoveryDatePicker';
import DraftWinBackButton from '@/components/DraftWinBackButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const URGENCY_BADGE: Record<DeclinedItem['urgency'], string> = {
  safety: 'bg-danger/15 text-danger',
  maintenance: 'bg-warn/15 text-warn',
  cosmetic: 'bg-cyan/15 text-cyan',
  unknown: 'bg-surface-2 text-muted',
};

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: { day?: string };
}) {
  let data: RecoveryResult | null = null;
  let error: string | null = null;
  // Advisor-aware: scope the recovery pass to the selected advisor (ss_advisor
  // cookie), falling back to the configured default (siltaylor) when unset.
  const advisorId = resolveAdvisorId(cookies().get('ss_advisor')?.value);
  // Optional day scoping (?day=YYYY-MM-DD); ignore anything malformed.
  const day = searchParams?.day && DAY_RE.test(searchParams.day) ? searchParams.day : undefined;
  try {
    data = await getRecovery(advisorId, day);
  } catch (err) {
    error = String((err as Error).message);
  }

  // Outreach log — degrade gracefully if the table/IAM isn't available yet.
  let outreach: OutreachRecord[] = [];
  try {
    outreach = await listOutreach(advisorId);
  } catch {
    outreach = [];
  }
  const sendEnabled = smsSendEnabled();

  const generatedAt = data ? clockUTC(data.generatedAt) : clockUTC(new Date().toISOString());
  const openItems = data?.items.filter((i) => !i.followUpLogged) ?? [];
  const openDollars = openItems.reduce((s, i) => s + (i.estDollars ?? 0), 0);

  return (
    <div className="px-6 py-5">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">Declined Work Recovery</h1>
          <p className="text-2xs text-muted">
            Claude analysis of {day ? `transcripts from ${day}` : 'recent transcripts'} ·{' '}
            {data?.transcriptsScanned ?? 0} scanned{data ? ` · ${data.model}` : ''}
          </p>
        </div>
        <RecoveryDatePicker day={day ?? null} />
      </header>

      {error ? (
        <div className="card border-l-2 border-l-danger">
          <span className="stat-label text-danger">Analysis unavailable</span>
          <p className="mt-2 text-sm text-fg/90">
            The recovery analysis couldn&apos;t run. Most likely the dashboard&apos;s AWS identity is
            missing <span className="font-mono text-cyan">bedrock:InvokeModel</span> on the Claude
            inference profiles.
          </p>
          <p className="mt-2 font-mono text-2xs text-muted">{error}</p>
        </div>
      ) : (
        <>
          {/* Money Moment hero */}
          <div className="card mb-5 border-l-2 border-l-magenta">
            <span className="stat-label">Recoverable — no follow-up logged</span>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="font-display text-3xl font-bold text-magenta">{usd(openDollars)}</span>
              <span className="text-2xs text-muted">
                across {openItems.length} declined item{openItems.length === 1 ? '' : 's'} ·{' '}
                {usd(data?.totalDollars ?? 0)} declined in total
              </span>
            </div>
          </div>

          {/* Items */}
          {!data || data.items.length === 0 ? (
            <div className="card text-xs text-muted">
              No declined work detected in the {data?.transcriptsScanned ?? 0}{' '}
              {day ? `transcript(s) from ${day}` : 'most recent transcripts'}
              {(data?.transcriptsScanned ?? 0) === 0
                ? day
                  ? ' (none captured that day).'
                  : ' (none transcribed yet).'
                : '.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.items.map((item, i) => (
                <div
                  key={`${item.transcriptId}-${i}`}
                  className={`card ${item.followUpLogged ? '' : 'border-l-2 border-l-magenta'}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-semibold text-fg">{item.declinedItem}</div>
                      <div className="text-2xs text-muted">
                        {item.vehicle ?? 'Vehicle n/a'}
                        {item.customer ? ` · ${item.customer}` : ''}
                      </div>
                    </div>
                    <span className={`badge font-mono ${URGENCY_BADGE[item.urgency]}`}>
                      {item.urgency}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-3">
                    <span className="font-mono text-lg font-bold text-fg">
                      {item.estDollars != null ? usd(item.estDollars) : '—'}
                    </span>
                    {item.followUpLogged ? (
                      <span className="badge bg-ok/15 text-ok">follow-up logged</span>
                    ) : (
                      <span className="badge bg-magenta/15 text-magenta">no follow-up</span>
                    )}
                  </div>

                  {item.quote && (
                    <p className="mt-2 border-l border-border pl-2 text-2xs italic leading-relaxed text-muted">
                      &ldquo;{item.quote}&rdquo;
                    </p>
                  )}
                  <p className="mt-2 font-mono text-2xs text-muted/70">{item.transcriptId}</p>

                  {/* DRAFT + LOG only — never sends. See lib/sms.ts (gated OFF). */}
                  <DraftWinBackButton item={item} />
                </div>
              ))}
            </div>
          )}

          {/* Outreach log — recent win-back drafts + status. */}
          <section className="mt-6">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-sm font-semibold tracking-tight">Outreach log</h2>
              <span
                className={`badge font-mono ${
                  sendEnabled ? 'bg-warn/15 text-warn' : 'bg-surface-2 text-muted'
                }`}
              >
                SMS send: {sendEnabled ? 'ENABLED (manual)' : 'OFF (default)'}
              </span>
            </div>
            <p className="mb-3 text-2xs text-muted">
              Drafts are saved for review only. Live customer SMS is scaffolded but disabled — it
              requires <span className="font-mono text-cyan">OUTREACH_SEND_ENABLED=true</span> plus
              Twilio credentials and a human in the loop. Nothing is auto-sent.
            </p>
            {outreach.length === 0 ? (
              <div className="card text-xs text-muted">
                No win-back drafts yet. Use &ldquo;Draft win-back text&rdquo; on a declined item above.
              </div>
            ) : (
              <div className="space-y-2">
                {outreach.map((o) => (
                  <div key={`${o.advisor_id}-${o.ts}`} className="card">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-fg">{o.declined_item}</span>
                      <div className="flex items-center gap-2">
                        <span className="badge bg-cyan/15 text-cyan">{o.status}</span>
                        <span className="text-2xs text-muted">{relativeTime(o.ts)}</span>
                      </div>
                    </div>
                    <div className="text-2xs text-muted">
                      {o.vehicle ?? 'Vehicle n/a'}
                      {o.customer ? ` · ${o.customer}` : ''}
                      {o.est_dollars != null ? ` · ${usd(o.est_dollars)}` : ''}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap border-l border-border pl-2 text-xs leading-relaxed text-fg/90">
                      {o.draft_text}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <p className="mt-5 text-2xs text-muted">
            Generated {generatedAt} UTC · cached ~30 min · estimates are model-inferred from the
            advisor&apos;s words, not from the DMS.
          </p>
        </>
      )}
    </div>
  );
}
