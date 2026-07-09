/**
 * Weekly Pilot Report (/intel/report) — dashboard view
 * =====================================================
 * Auto-generated weekly summary: aggregates pilot data into summary cards with
 * trend indicators vs prior week, top highlights, and an "Email this report"
 * button that invokes the Lambda sender.
 *
 * Server-rendered with client-side interactivity for the email button and
 * sparkline charts. Data fetched server-side from the shared lib.
 */
import { generateWeeklyReport, type WeeklyReportData } from '@/lib/weekly-report';
import StatusCard from '@/components/StatusCard';
import WeeklyReportClient from './WeeklyReportClient';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatDollars(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function trendLabel(current: number, prior: number): string {
  if (prior === 0) return current > 0 ? '↑ new' : '—';
  const pct = Math.round(((current - prior) / prior) * 100);
  if (pct === 0) return '→ flat';
  return pct > 0 ? `↑ ${pct}%` : `↓ ${Math.abs(pct)}%`;
}

function trendTone(current: number, prior: number, higherIsBetter = true): 'ok' | 'warn' | 'idle' {
  if (prior === 0) return current > 0 ? 'ok' : 'idle';
  const pct = ((current - prior) / prior) * 100;
  if (Math.abs(pct) < 5) return 'idle';
  if (higherIsBetter) return pct > 0 ? 'ok' : 'warn';
  return pct < 0 ? 'ok' : 'warn';
}

export default async function WeeklyReportPage() {
  let report: WeeklyReportData | null = null;
  let error: string | null = null;

  try {
    report = await generateWeeklyReport();
  } catch (err) {
    error = String((err as Error).message);
  }

  if (error || !report) {
    return (
      <div className="px-6 py-5">
        <header className="mb-5">
          <h1 className="font-display text-xl font-bold tracking-tight">Weekly Report</h1>
          <p className="text-2xs text-muted">Auto-generated pilot summary</p>
        </header>
        <div className="card border-l-2 border-l-danger">
          <span className="stat-label text-danger">Report unavailable</span>
          <p className="mt-2 text-sm text-fg/90">
            Could not generate the weekly report. Check that the dashboard has
            access to S3, DynamoDB (usage + outreach tables), and that data exists.
          </p>
          <p className="mt-2 font-mono text-2xs text-muted">{error}</p>
        </div>
      </div>
    );
  }

  const { current: c, prior: p } = report;

  return (
    <div className="px-6 py-5">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">Weekly Report</h1>
          <p className="text-2xs text-muted">
            {report.start} → {report.end} · vs prior week
          </p>
        </div>
        <WeeklyReportClient start={report.start} end={report.end} />
      </header>

      {/* Summary metric cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatusCard
          label="Total Events"
          value={c.totalEvents.toLocaleString()}
          tone={trendTone(c.totalEvents, p.totalEvents)}
          sub={trendLabel(c.totalEvents, p.totalEvents)}
        />
        <StatusCard
          label="Active Hours"
          value={c.activeHours}
          tone={trendTone(c.activeHours, p.activeHours)}
          sub={trendLabel(c.activeHours, p.activeHours)}
        />
        <StatusCard
          label="Declined Work $"
          value={formatDollars(c.declinedDollars)}
          tone={trendTone(c.declinedDollars, p.declinedDollars, false)}
          sub={trendLabel(c.declinedDollars, p.declinedDollars)}
        />
        <StatusCard
          label="Assistant Queries"
          value={c.assistantQueries.toLocaleString()}
          tone={trendTone(c.assistantQueries, p.assistantQueries)}
          sub={trendLabel(c.assistantQueries, p.assistantQueries)}
        />
        <StatusCard
          label="Avg Switches/hr"
          value={c.avgSwitchesPerHour}
          tone={trendTone(c.avgSwitchesPerHour, p.avgSwitchesPerHour, false)}
          sub={trendLabel(c.avgSwitchesPerHour, p.avgSwitchesPerHour)}
        />
      </div>

      {/* Trend sparklines — visual comparison */}
      <section className="mt-6">
        <h2 className="stat-label mb-3">Week-over-Week Comparison</h2>
        <div className="card overflow-hidden p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th className="text-right">This Week</th>
                <th className="text-right">Prior Week</th>
                <th className="text-right">Change</th>
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Total Events', cur: c.totalEvents, prev: p.totalEvents },
                { label: 'Active Hours', cur: c.activeHours, prev: p.activeHours },
                { label: 'Declined $', cur: c.declinedDollars, prev: p.declinedDollars },
                { label: 'Assistant Queries', cur: c.assistantQueries, prev: p.assistantQueries },
                { label: 'Switches/hr', cur: c.avgSwitchesPerHour, prev: p.avgSwitchesPerHour },
              ].map((row) => {
                const delta = row.prev > 0 ? Math.round(((row.cur - row.prev) / row.prev) * 100) : 0;
                const barWidth = Math.min(Math.abs(delta), 100);
                return (
                  <tr key={row.label}>
                    <td className="text-fg">{row.label}</td>
                    <td className="text-right font-mono">{row.cur.toLocaleString()}</td>
                    <td className="text-right font-mono text-muted">{row.prev.toLocaleString()}</td>
                    <td className="text-right">
                      <span className={delta > 0 ? 'text-green' : delta < 0 ? 'text-danger' : 'text-muted'}>
                        {delta > 0 ? '+' : ''}{delta}%
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <div className="h-2 w-20 rounded-full bg-surface-2">
                          <div
                            className={`h-2 rounded-full ${delta >= 0 ? 'bg-cyan' : 'bg-danger'}`}
                            style={{ width: `${barWidth}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Highlights */}
      {report.highlights.length > 0 && (
        <section className="mt-6">
          <h2 className="stat-label mb-3">Top Insights</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {report.highlights.map((h, i) => (
              <div key={i} className="card border-l-2 border-l-cyan">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-fg">{h.title}</span>
                  {h.metric && (
                    <span className="rounded bg-cyan/10 px-2 py-0.5 text-2xs font-mono text-cyan">
                      {h.metric}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">{h.detail}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="mt-6 text-2xs text-muted">
        Generated {new Date(report.generatedAt).toISOString().slice(0, 16).replace('T', ' ')} UTC
      </p>
    </div>
  );
}
