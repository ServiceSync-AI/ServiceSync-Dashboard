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
import { getCloudSpendMTD, type CloudSpendMTD } from '@/lib/awscost';
import { getInstancesInfo, type InstancesResponse } from '@/lib/ec2';
import { clockUTC } from '@/lib/format';
import PilotROI from '@/components/PilotROI';

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

/**
 * Owner-side cloud spend for the current month, read from AWS Cost Explorer.
 * Additive to the per-advisor view: this is the dashboard's own AWS bill, not
 * attributable to any single advisor.
 */
function CloudSpendCard({ spend }: { spend: CloudSpendMTD }) {
  if (!spend.available) {
    return (
      <div className="card mb-5 border-l-2 border-l-border text-xs leading-relaxed text-fg/90">
        <span className="stat-label">Cloud spend — month to date</span>
        <p className="mt-2 text-muted">
          Cloud cost unavailable — the dashboard&apos;s AWS identity needs{' '}
          <span className="font-mono text-cyan">ce:GetCostAndUsage</span>.
        </p>
        <p className="mt-2 font-mono text-2xs text-muted">{spend.error}</p>
      </div>
    );
  }

  return (
    <div className="card mb-5 border-l-2 border-l-cyan">
      <span className="stat-label">Cloud spend — month to date</span>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="font-display text-3xl font-bold text-cyan">{usd(spend.totalUsd)}</span>
        <span className="text-2xs text-muted">
          {spend.month} · AWS UnblendedCost · top {spend.byService.length} service
          {spend.byService.length === 1 ? '' : 's'}
        </span>
      </div>
      <p className="mt-2 text-2xs text-muted">
        AWS credits may mask real spend — figures can read ~$0 until credits are exhausted.
      </p>
      {spend.byService.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Service</th>
                <th className="text-right">$ MTD</th>
              </tr>
            </thead>
            <tbody>
              {spend.byService.map((s) => (
                <tr key={s.service}>
                  <td className="text-fg">{s.service}</td>
                  <td className="text-right text-cyan">{usd(s.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Live EC2 infrastructure card — shows all instances, their state, type, and
 * estimated monthly cost. Fetched server-side via ec2:DescribeInstances.
 */
function InfrastructureCard({ infra }: { infra: InstancesResponse | null }) {
  if (!infra) {
    return (
      <div className="card mb-5 border-l-2 border-l-border text-xs leading-relaxed text-fg/90">
        <span className="stat-label">Infrastructure</span>
        <p className="mt-2 text-muted">
          EC2 data unavailable — the dashboard&apos;s AWS identity needs{' '}
          <span className="font-mono text-cyan">ec2:DescribeInstances</span>.
        </p>
      </div>
    );
  }

  if (infra.instances.length === 0) {
    return (
      <div className="card mb-5 border-l-2 border-l-border text-xs leading-relaxed text-fg/90">
        <span className="stat-label">Infrastructure</span>
        <p className="mt-2 text-muted">No EC2 instances found in {infra.region}.</p>
      </div>
    );
  }

  return (
    <div className="card mb-5 border-l-2 border-l-green">
      <span className="stat-label">Infrastructure — EC2 instances</span>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="font-display text-3xl font-bold text-green">
          {usd(infra.totalEstimatedMonthlyCost)}
          <span className="ml-1 text-sm font-normal text-muted">/mo est.</span>
        </span>
        <span className="text-2xs text-muted">
          {infra.instances.length} instance{infra.instances.length === 1 ? '' : 's'} · {infra.region}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Instance</th>
              <th>Type</th>
              <th>State</th>
              <th className="text-right">Uptime</th>
              <th className="text-right">$/mo</th>
            </tr>
          </thead>
          <tbody>
            {infra.instances.map((inst) => (
              <tr key={inst.instanceId}>
                <td className="text-fg">{inst.name ?? '—'}</td>
                <td className="font-mono text-2xs text-muted">{inst.instanceId}</td>
                <td className="font-mono text-2xs">{inst.instanceType}</td>
                <td>
                  <span
                    className={
                      inst.state === 'running'
                        ? 'text-green'
                        : inst.state === 'stopped'
                          ? 'text-warn'
                          : 'text-muted'
                    }
                  >
                    {inst.state}
                  </span>
                </td>
                <td className="text-right text-muted text-2xs">
                  {inst.uptimeHours != null
                    ? inst.uptimeHours >= 24
                      ? `${Math.floor(inst.uptimeHours / 24)}d ${inst.uptimeHours % 24}h`
                      : `${inst.uptimeHours}h`
                    : '—'}
                </td>
                <td className="text-right text-green">
                  {inst.estimatedMonthlyCost != null ? usd(inst.estimatedMonthlyCost) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-2xs text-muted">
        Costs are On-Demand estimates (Linux, {infra.region}). Actual may differ with RIs/Savings Plans.
      </p>
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

  const cloudSpend = await getCloudSpendMTD();
  const infraData = await getInstancesInfo();

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

      {/* Owner-side AWS cloud spend (MTD) — additive, independent of per-advisor data. */}
      <CloudSpendCard spend={cloudSpend} />

      {/* Pilot ROI — cost per insight across all sources. */}
      <PilotROI />

      {/* Live EC2 infrastructure — per-instance cost view. */}
      <InfrastructureCard infra={infraData} />

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
