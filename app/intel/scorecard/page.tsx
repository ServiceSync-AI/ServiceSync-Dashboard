/**
 * Advisor Scorecard (/intel/scorecard)
 * ====================================
 * Daily 0-100 productivity score with a 14-day sparkline bar chart and a
 * detailed breakdown of each scoring factor. Server component — data fetched
 * at render time from the scorecard API route.
 */
'use client';

import { useEffect, useState } from 'react';

interface ScoreBreakdown {
  activeHours: { value: number; points: number; max: 25 };
  contextSwitches: { value: number; points: number; max: 25 };
  frictionBursts: { value: number; points: number; max: 25 };
  assistantUsage: { value: number; points: number; max: 15 };
  extensionUptime: { value: number; points: number; max: 10 };
}

interface ScorecardDay {
  date: string;
  score: number;
  breakdown: ScoreBreakdown;
  color: 'green' | 'yellow' | 'red';
}

const COLOR_MAP = {
  green: 'text-ok',
  yellow: 'text-warn',
  red: 'text-danger',
} as const;

const BG_COLOR_MAP = {
  green: 'bg-ok',
  yellow: 'bg-warn',
  red: 'bg-danger',
} as const;

/** Format a date as short label like "Mon 7/7" */
function shortDate(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const month = d.getUTCMonth() + 1;
  const date = d.getUTCDate();
  return `${day} ${month}/${date}`;
}

function BreakdownRow({
  label,
  value,
  valueLabel,
  points,
  max,
}: {
  label: string;
  value: number;
  valueLabel: string;
  points: number;
  max: number;
}) {
  const pct = max > 0 ? (points / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border last:border-0">
      <div className="w-40 text-xs text-fg">{label}</div>
      <div className="flex-1">
        <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              pct >= 80 ? 'bg-ok' : pct >= 50 ? 'bg-warn' : 'bg-danger'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="w-20 text-right text-2xs text-muted">{valueLabel}</div>
      <div className="w-16 text-right font-mono text-xs text-fg">
        {points}/{max}
      </div>
    </div>
  );
}

export default function ScorecardPage() {
  const [scores, setScores] = useState<ScorecardDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchScores() {
      try {
        // Fetch last 14 days
        const end = new Date();
        const start = new Date(end.getTime() - 13 * 86_400_000);
        const startStr = start.toISOString().slice(0, 10);
        const endStr = end.toISOString().slice(0, 10);

        const res = await fetch(`/api/intel/scorecard?start=${startStr}&end=${endStr}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setScores(data.scores ?? []);
      } catch (err) {
        setError(String((err as Error).message));
      } finally {
        setLoading(false);
      }
    }
    fetchScores();
  }, []);

  const today = scores.length > 0 ? scores[scores.length - 1] : null;

  return (
    <div className="px-6 py-5">
      <header className="mb-5">
        <h1 className="font-display text-xl font-bold tracking-tight">Advisor Scorecard</h1>
        <p className="text-2xs text-muted">
          Daily productivity score · 5 weighted factors · last 14 days
        </p>
      </header>

      {loading && (
        <div className="card animate-pulse">
          <div className="h-24 bg-surface-2 rounded" />
        </div>
      )}

      {error && (
        <div className="card border-l-2 border-l-danger">
          <span className="stat-label text-danger">Scorecard unavailable</span>
          <p className="mt-2 text-sm text-fg/90">
            Failed to load scorecard data. The extension may not have reported events yet,
            or the API encountered an error.
          </p>
          <p className="mt-2 font-mono text-2xs text-muted">{error}</p>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Today's Score Hero */}
          <div className="card mb-5 border-l-2 border-l-cyan">
            <span className="stat-label">Today&apos;s Score</span>
            {today ? (
              <div className="mt-2 flex items-baseline gap-4">
                <span className={`font-display text-6xl font-bold ${COLOR_MAP[today.color]}`}>
                  {today.score}
                </span>
                <span className="text-2xs text-muted">/ 100</span>
                <span
                  className={`badge ${
                    today.color === 'green'
                      ? 'bg-ok/10 text-ok'
                      : today.color === 'yellow'
                        ? 'bg-warn/10 text-warn'
                        : 'bg-danger/10 text-danger'
                  }`}
                >
                  {today.color === 'green'
                    ? '🟢 Great day'
                    : today.color === 'yellow'
                      ? '🟡 Decent'
                      : '🔴 Needs attention'}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-muted">No data for today yet.</p>
            )}
          </div>

          {/* 14-Day Bar Chart */}
          <div className="card mb-5">
            <span className="stat-label">Last 14 Days</span>
            <div className="mt-3 flex items-end gap-1 h-32">
              {scores.map((day) => {
                const height = Math.max(4, (day.score / 100) * 100);
                return (
                  <div
                    key={day.date}
                    className="flex-1 flex flex-col items-center gap-1"
                    title={`${day.date}: ${day.score}/100`}
                  >
                    <span className="text-2xs font-mono text-muted">{day.score}</span>
                    <div className="w-full flex-1 flex items-end">
                      <div
                        className={`w-full rounded-t ${BG_COLOR_MAP[day.color]} opacity-80 hover:opacity-100 transition-opacity`}
                        style={{ height: `${height}%` }}
                      />
                    </div>
                    <span className="text-2xs text-muted truncate w-full text-center">
                      {new Date(day.date + 'T12:00:00Z').getUTCDate()}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex justify-between text-2xs text-muted">
              <span>{scores.length > 0 ? shortDate(scores[0].date) : ''}</span>
              <span>{scores.length > 0 ? shortDate(scores[scores.length - 1].date) : ''}</span>
            </div>
          </div>

          {/* Breakdown Card */}
          {today && (
            <div className="card">
              <span className="stat-label">Score Breakdown — {today.date}</span>
              <div className="mt-3">
                <BreakdownRow
                  label="🕐 Active Hours"
                  value={today.breakdown.activeHours.value}
                  valueLabel={`${today.breakdown.activeHours.value}h (target: 6h)`}
                  points={today.breakdown.activeHours.points}
                  max={today.breakdown.activeHours.max}
                />
                <BreakdownRow
                  label="🔀 Context Switches"
                  value={today.breakdown.contextSwitches.value}
                  valueLabel={`${today.breakdown.contextSwitches.value}/hr (target: <8)`}
                  points={today.breakdown.contextSwitches.points}
                  max={today.breakdown.contextSwitches.max}
                />
                <BreakdownRow
                  label="⚡ Friction Bursts"
                  value={today.breakdown.frictionBursts.value}
                  valueLabel={`${today.breakdown.frictionBursts.value} bursts (target: 0)`}
                  points={today.breakdown.frictionBursts.points}
                  max={today.breakdown.frictionBursts.max}
                />
                <BreakdownRow
                  label="🤖 Assistant Usage"
                  value={today.breakdown.assistantUsage.value}
                  valueLabel={`${today.breakdown.assistantUsage.value} queries (need: 1+)`}
                  points={today.breakdown.assistantUsage.points}
                  max={today.breakdown.assistantUsage.max}
                />
                <BreakdownRow
                  label="📡 Extension Uptime"
                  value={today.breakdown.extensionUptime.value}
                  valueLabel={`${today.breakdown.extensionUptime.value}h (target: 8h)`}
                  points={today.breakdown.extensionUptime.points}
                  max={today.breakdown.extensionUptime.max}
                />
              </div>
              <div className="mt-4 pt-3 border-t border-border flex items-center justify-between">
                <span className="text-xs text-muted">Total</span>
                <span className={`font-display text-2xl font-bold ${COLOR_MAP[today.color]}`}>
                  {today.score}/100
                </span>
              </div>
            </div>
          )}

          {/* Scoring Legend */}
          <div className="mt-4 flex gap-4 text-2xs text-muted">
            <span className="flex items-center gap-1">
              <span className="dot bg-ok" /> 80+ Great
            </span>
            <span className="flex items-center gap-1">
              <span className="dot bg-warn" /> 60-79 Decent
            </span>
            <span className="flex items-center gap-1">
              <span className="dot bg-danger" /> &lt;60 Needs work
            </span>
          </div>
        </>
      )}
    </div>
  );
}
