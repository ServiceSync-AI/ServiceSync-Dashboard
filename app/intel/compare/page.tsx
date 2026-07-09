/**
 * Before/After Comparison (/intel/compare)
 * =========================================
 * Two date-range pickers with quick presets. Side-by-side comparison cards
 * showing key metrics with % change arrows. Green = improvement, red = regression.
 */
'use client';

import { useState } from 'react';

interface EventsSummary {
  totalEvents: number;
  totalHours: number;
  idleMinutes: number;
  avgSwitchesPerHour: number;
  appBreakdown: Record<string, number>;
  byDay: { date: string; events: number; minutes: number }[];
  rangeStart: string | null;
  rangeEnd: string | null;
}

interface ComparisonPeriod {
  start: string;
  end: string;
  summary: EventsSummary;
  frictionBursts: number;
  totalSessions: number;
  daysInRange: number;
}

interface Delta {
  value: number;
  direction: 'up' | 'down' | 'flat';
  improved: boolean;
}

interface Deltas {
  activeHours: Delta;
  avgSwitchesPerHour: Delta;
  frictionBursts: Delta;
  totalEvents: Delta;
  idleMinutes: Delta;
}

interface CompareData {
  periodA: ComparisonPeriod;
  periodB: ComparisonPeriod;
  deltas: Deltas;
}

/** Get Monday of the current week (UTC). */
function getMonday(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  return copy;
}

/** Format YYYY-MM-DD from a Date. */
function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function DeltaArrow({ delta }: { delta: Delta }) {
  if (delta.direction === 'flat') {
    return <span className="text-muted text-xs">→ 0%</span>;
  }
  const icon = delta.direction === 'up' ? '↑' : '↓';
  const color = delta.improved ? 'text-ok' : 'text-danger';
  return (
    <span className={`${color} text-sm font-semibold`}>
      {icon} {Math.abs(delta.value).toFixed(1)}%
    </span>
  );
}

function ComparisonCard({
  label,
  icon,
  valueA,
  valueB,
  unitA,
  unitB,
  delta,
}: {
  label: string;
  icon: string;
  valueA: string;
  valueB: string;
  unitA?: string;
  unitB?: string;
  delta: Delta;
}) {
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-2xs text-muted mb-1">Period A</div>
          <div className="font-display text-xl font-bold text-fg">
            {valueA}
            {unitA && <span className="text-xs font-normal text-muted ml-1">{unitA}</span>}
          </div>
        </div>
        <div>
          <div className="text-2xs text-muted mb-1">Period B</div>
          <div className="font-display text-xl font-bold text-fg">
            {valueB}
            {unitB && <span className="text-xs font-normal text-muted ml-1">{unitB}</span>}
          </div>
        </div>
      </div>
      <div className="mt-3 pt-2 border-t border-border flex items-center gap-2">
        <DeltaArrow delta={delta} />
        <span className="text-2xs text-muted">
          {delta.improved ? 'Improved' : delta.direction === 'flat' ? 'No change' : 'Regression'}
        </span>
      </div>
    </div>
  );
}

function TopSystemsComparison({
  breakdownA,
  breakdownB,
}: {
  breakdownA: Record<string, number>;
  breakdownB: Record<string, number>;
}) {
  // Combine and get top 5 systems
  const allSystems = new Set([...Object.keys(breakdownA), ...Object.keys(breakdownB)]);
  const ranked = [...allSystems]
    .map((sys) => ({
      system: sys,
      minutesA: breakdownA[sys] ?? 0,
      minutesB: breakdownB[sys] ?? 0,
    }))
    .sort((a, b) => (b.minutesA + b.minutesB) - (a.minutesA + a.minutesB))
    .slice(0, 6);

  const totalA = Object.values(breakdownA).reduce((s, v) => s + v, 0) || 1;
  const totalB = Object.values(breakdownB).reduce((s, v) => s + v, 0) || 1;

  return (
    <div className="card col-span-full">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">🥧</span>
        <span className="stat-label">Top Systems — Time Distribution</span>
      </div>
      <div className="overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>System</th>
              <th className="text-right">Period A (min)</th>
              <th className="text-right">Period A %</th>
              <th className="text-right">Period B (min)</th>
              <th className="text-right">Period B %</th>
              <th className="text-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {ranked.map((row) => {
              const pctA = ((row.minutesA / totalA) * 100).toFixed(1);
              const pctB = ((row.minutesB / totalB) * 100).toFixed(1);
              const change = row.minutesA > 0
                ? (((row.minutesB - row.minutesA) / row.minutesA) * 100).toFixed(1)
                : row.minutesB > 0 ? '+∞' : '0';
              return (
                <tr key={row.system}>
                  <td className="text-fg">{row.system}</td>
                  <td className="text-right">{Math.round(row.minutesA)}</td>
                  <td className="text-right text-muted">{pctA}%</td>
                  <td className="text-right">{Math.round(row.minutesB)}</td>
                  <td className="text-right text-muted">{pctB}%</td>
                  <td className="text-right">
                    <span className={
                      Number(change) > 0 ? 'text-cyan' : Number(change) < 0 ? 'text-warn' : 'text-muted'
                    }>
                      {Number(change) > 0 ? '+' : ''}{change}%
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function ComparePage() {
  const now = new Date();
  const monday = getMonday(now);
  const lastMonday = new Date(monday.getTime() - 7 * 86_400_000);
  const lastSunday = new Date(monday.getTime() - 86_400_000);

  const [startA, setStartA] = useState(fmt(lastMonday));
  const [endA, setEndA] = useState(fmt(lastSunday));
  const [startB, setStartB] = useState(fmt(monday));
  const [endB, setEndB] = useState(fmt(now));

  const [data, setData] = useState<CompareData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runComparison() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/intel/compare?startA=${startA}&endA=${endA}&startB=${startB}&endB=${endB}`,
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(preset: 'week' | 'month') {
    if (preset === 'week') {
      const mon = getMonday(now);
      const lastMon = new Date(mon.getTime() - 7 * 86_400_000);
      const lastSun = new Date(mon.getTime() - 86_400_000);
      setStartA(fmt(lastMon));
      setEndA(fmt(lastSun));
      setStartB(fmt(mon));
      setEndB(fmt(now));
    } else {
      // This month vs last month
      const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const lastMonthEnd = new Date(thisMonthStart.getTime() - 86_400_000);
      setStartA(fmt(lastMonthStart));
      setEndA(fmt(lastMonthEnd));
      setStartB(fmt(thisMonthStart));
      setEndB(fmt(now));
    }
  }

  return (
    <div className="px-6 py-5">
      <header className="mb-5">
        <h1 className="font-display text-xl font-bold tracking-tight">Before / After Comparison</h1>
        <p className="text-2xs text-muted">
          Compare two time periods side-by-side · identify trends and improvements
        </p>
      </header>

      {/* Date Pickers + Presets */}
      <div className="card mb-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Period A */}
          <div>
            <label className="stat-label block mb-2">Period A (Before)</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startA}
                onChange={(e) => setStartA(e.target.value)}
                className="flex-1 rounded border border-border bg-surface-2 px-3 py-1.5 text-xs text-fg focus:border-cyan focus:outline-none"
              />
              <span className="text-muted self-center text-xs">to</span>
              <input
                type="date"
                value={endA}
                onChange={(e) => setEndA(e.target.value)}
                className="flex-1 rounded border border-border bg-surface-2 px-3 py-1.5 text-xs text-fg focus:border-cyan focus:outline-none"
              />
            </div>
          </div>

          {/* Period B */}
          <div>
            <label className="stat-label block mb-2">Period B (After)</label>
            <div className="flex gap-2">
              <input
                type="date"
                value={startB}
                onChange={(e) => setStartB(e.target.value)}
                className="flex-1 rounded border border-border bg-surface-2 px-3 py-1.5 text-xs text-fg focus:border-cyan focus:outline-none"
              />
              <span className="text-muted self-center text-xs">to</span>
              <input
                type="date"
                value={endB}
                onChange={(e) => setEndB(e.target.value)}
                className="flex-1 rounded border border-border bg-surface-2 px-3 py-1.5 text-xs text-fg focus:border-cyan focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* Presets + Run */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-2xs text-muted">Quick:</span>
          <button
            onClick={() => applyPreset('week')}
            className="badge bg-surface-2 text-fg hover:bg-cyan/10 hover:text-cyan transition-colors cursor-pointer"
          >
            This week vs last week
          </button>
          <button
            onClick={() => applyPreset('month')}
            className="badge bg-surface-2 text-fg hover:bg-cyan/10 hover:text-cyan transition-colors cursor-pointer"
          >
            This month vs last month
          </button>
          <div className="flex-1" />
          <button
            onClick={runComparison}
            disabled={loading}
            className="rounded bg-cyan px-4 py-1.5 text-xs font-medium text-bg hover:bg-cyan/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'Comparing…' : 'Compare'}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="card border-l-2 border-l-danger mb-5">
          <span className="stat-label text-danger">Comparison failed</span>
          <p className="mt-2 text-sm text-fg/90">{error}</p>
        </div>
      )}

      {/* Results */}
      {data && (
        <>
          {/* Period labels */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="card border-l-2 border-l-violet">
              <span className="stat-label text-violet">Period A</span>
              <p className="text-xs text-fg mt-1">
                {data.periodA.start} → {data.periodA.end}
              </p>
              <p className="text-2xs text-muted">
                {data.periodA.daysInRange} days · {data.periodA.summary.totalEvents} events ·{' '}
                {data.periodA.totalSessions} sessions
              </p>
            </div>
            <div className="card border-l-2 border-l-cyan">
              <span className="stat-label text-cyan">Period B</span>
              <p className="text-xs text-fg mt-1">
                {data.periodB.start} → {data.periodB.end}
              </p>
              <p className="text-2xs text-muted">
                {data.periodB.daysInRange} days · {data.periodB.summary.totalEvents} events ·{' '}
                {data.periodB.totalSessions} sessions
              </p>
            </div>
          </div>

          {/* Metric Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <ComparisonCard
              label="Active Hours"
              icon="🕐"
              valueA={data.periodA.summary.totalHours.toFixed(1)}
              valueB={data.periodB.summary.totalHours.toFixed(1)}
              unitA="hrs"
              unitB="hrs"
              delta={data.deltas.activeHours}
            />
            <ComparisonCard
              label="Avg Switches/Hr"
              icon="🔀"
              valueA={String(data.periodA.summary.avgSwitchesPerHour)}
              valueB={String(data.periodB.summary.avgSwitchesPerHour)}
              unitA="/hr"
              unitB="/hr"
              delta={data.deltas.avgSwitchesPerHour}
            />
            <ComparisonCard
              label="Friction Bursts"
              icon="⚡"
              valueA={String(data.periodA.frictionBursts)}
              valueB={String(data.periodB.frictionBursts)}
              unitA="bursts"
              unitB="bursts"
              delta={data.deltas.frictionBursts}
            />
            <ComparisonCard
              label="Idle Time"
              icon="💤"
              valueA={String(data.periodA.summary.idleMinutes)}
              valueB={String(data.periodB.summary.idleMinutes)}
              unitA="min"
              unitB="min"
              delta={data.deltas.idleMinutes}
            />
          </div>

          {/* Top Systems Table */}
          <TopSystemsComparison
            breakdownA={data.periodA.summary.appBreakdown}
            breakdownB={data.periodB.summary.appBreakdown}
          />
        </>
      )}

      {/* Empty state */}
      {!data && !error && !loading && (
        <div className="card text-center py-12">
          <span className="text-4xl">⚖️</span>
          <p className="mt-3 text-sm text-muted">
            Select two date ranges and click <span className="text-cyan">Compare</span> to see
            how metrics changed between periods.
          </p>
        </div>
      )}
    </div>
  );
}
