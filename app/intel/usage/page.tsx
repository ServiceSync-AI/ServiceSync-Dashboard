/**
 * Usage & Cost (/intel/usage) — per-advisor assistant spend
 * =========================================================
 * What each advisor's assistant usage costs: messages, in/out tokens, and
 * dollars (today + last 30 days), read from the `servicesync-assistant-usage`
 * metering table. Owner/testing traffic is bucketed separately so it never
 * inflates the real-advisor totals.
 *
 * Token/cost columns populate once the metering backend lands; until then this
 * degrades to a messages-only view (older rows carry only `msg_count`).
 *
 * NOTE: Recovery + Audit model costs are OWNER-side (billed to the dashboard's
 * own AWS identity, not attributable per advisor) and are tracked separately —
 * this page is strictly per-advisor assistant traffic.
 */
import { getUsageReport, type AdvisorUsage, type UsageReport } from '@/lib/usage';
import { clockUTC } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const int = (n: number) => n.toLocaleString('en-US');

/** A single advisor table — reused for the real and testing buckets. */
function UsageTable({
  rows,
  showCost,
  muted,
}: {
  rows: AdvisorUsage[];
  showCost: boolean;
  muted?: boolean;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="data-table">
        <thead>
          <tr>
            <th>Advisor</th>
            <th className="text-right">Messages</th>
            <th className="text-right">In tok</th>
            <th className="text-right">Out tok</th>
            {showCost && <th className="text-right">$ Today</th>}
            {showCost && <th className="text-right">$ 30d</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.advisorId}>
              <td className={muted ? 'text-muted' : 'text-fg'}>{r.advisorId}</td>
              <td className="text-right">{int(r.messages30d)}</td>
              <td className="text-right text-muted">{r.inTokens30d ? int(r.inTokens30d) : '—'}</td>
              <td className="text-right text-muted">{r.outTokens30d ? int(r.outTokens30d) : '—'}</td>
              {showCost && (
                <td className="text-right text-cyan">{r.costToday ? usd(r.costToday) : '—'}</td>
              )}
              {showCost && (
                <td className="text-right text-magenta">{r.cost30d ? usd(r.cost30d) : '—'}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function UsagePage() {
  let data: UsageReport | null = null;
  let error: string | null = null;
  try {
    data = await getUsageReport();
  } catch (err) {
    error = String((err as Error).message);
  }

  const generatedAt = data ? clockUTC(data.generatedAt) : clockUTC(new Date().toISOString());
  const showCost = data?.hasCostData ?? false;

  return (
    <div className="px-6 py-5">
      <header className="mb-5">
        <h1 className="font-display text-xl font-bold tracking-tight">Usage &amp; Cost</h1>
        <p className="text-2xs text-muted">
          Per-advisor assistant usage · last {data?.windowDays ?? 30} days
          {data ? ` · ${data.rowCount} daily rows` : ''}
        </p>
      </header>

      {error ? (
        <div className="card border-l-2 border-l-danger">
          <span className="stat-label text-danger">Usage unavailable</span>
          <p className="mt-2 text-sm text-fg/90">
            The usage report couldn&apos;t run. Most likely the dashboard&apos;s AWS identity is
            missing <span className="font-mono text-cyan">dynamodb:Query</span> /{' '}
            <span className="font-mono text-cyan">GetItem</span> on the{' '}
            <span className="font-mono text-cyan">servicesync-assistant-usage</span> table.
          </p>
          <p className="mt-2 font-mono text-2xs text-muted">{error}</p>
        </div>
      ) : (
        <>
          {/* Owner-cost disclaimer */}
          <div className="card mb-4 border-l-2 border-l-violet text-xs leading-relaxed text-fg/90">
            <span className="stat-label text-violet">Scope</span>
            <p className="mt-1">
              This is <span className="text-fg">per-advisor assistant traffic</span> only.{' '}
              <span className="text-muted">
                Recovery + Audit model costs are owner-side (billed to the dashboard&apos;s own AWS
                identity, not attributable to any one advisor) and are tracked separately.
              </span>
            </p>
          </div>

          {/* Totals hero (real advisors only) */}
          <div className="card mb-5 border-l-2 border-l-magenta">
            <span className="stat-label">Real advisors — last {data!.windowDays} days</span>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="font-display text-3xl font-bold text-magenta">
                {showCost ? usd(data!.totals.cost30d) : int(data!.totals.messages30d)}
                {!showCost && <span className="ml-1 text-sm font-normal text-muted">messages</span>}
              </span>
              <span className="text-2xs text-muted">
                {int(data!.totals.messages30d)} messages · {int(data!.totals.inTokens30d)} in /{' '}
                {int(data!.totals.outTokens30d)} out tokens
                {showCost ? ` · ${usd(data!.totals.costToday)} today` : ''} ·{' '}
                {data!.advisors.length} advisor{data!.advisors.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          {/* Metering-pending note */}
          {!showCost && (
            <div className="card mb-4 border-l-2 border-l-warn text-xs leading-relaxed text-fg/90">
              <span className="stat-label text-warn">Messages only</span>
              <p className="mt-1 text-muted">
                Token/cost metering populates once the metering backend is deployed. Until then only
                message counts are recorded.
              </p>
            </div>
          )}

          {/* Real advisors */}
          <section className="mb-6">
            <h2 className="stat-label mb-2">Advisors</h2>
            {data!.advisors.length === 0 ? (
              <div className="card text-xs text-muted">
                No advisor usage recorded in the last {data!.windowDays} days.
              </div>
            ) : (
              <UsageTable rows={data!.advisors} showCost={showCost} />
            )}
          </section>

          {/* Testing / owner bucket */}
          {data!.testing.length > 0 && (
            <section className="mb-6">
              <h2 className="stat-label mb-2">Testing / owner</h2>
              <p className="mb-2 text-2xs text-muted">
                Excluded from the totals above — owner/test traffic (ids starting with{' '}
                <span className="font-mono">test</span> or{' '}
                <span className="font-mono">frazier-testing</span>).
              </p>
              <UsageTable rows={data!.testing} showCost={showCost} muted />
            </section>
          )}

          <p className="mt-5 text-2xs text-muted">
            Generated {generatedAt} UTC · source: servicesync-assistant-usage · tokens/$ default to 0
            on rows that predate metering.
          </p>
        </>
      )}
    </div>
  );
}
