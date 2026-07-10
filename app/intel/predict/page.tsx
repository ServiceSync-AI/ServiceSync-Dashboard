/**
 * Predictive Scheduling — /intel/predict
 * =======================================
 * Hero heatmap grid (7 cols Mon-Sun × 12 rows 7AM-7PM), tomorrow's forecast
 * card, weekly pattern bar chart, and staffing suggestion text.
 */
'use client';

import { useEffect, useState } from 'react';

/* ═══════════════════════════════ TYPES ═══════════════════════════════════ */

interface PredictData {
  heatmap: Record<string, Record<string, number>>;
  busiestDay: string;
  busiestHours: number[];
  quietestDay: string;
  quietestHours: number[];
  prediction: {
    tomorrow: {
      day: string;
      peakHours: number[];
      expectedLoad: number;
    };
  };
  weeklyPattern: Record<string, number>;
}

/* ═══════════════════════════════ HELPERS ══════════════════════════════════ */

const DISPLAY_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DISPLAY_HOURS = Array.from({ length: 12 }, (_, i) => i + 7); // 7AM - 6PM (7..18)

/** Map intensity 0..max to a color from surface → cyan → magenta. */
function intensityColor(value: number, max: number): string {
  if (max === 0 || value === 0) return 'rgba(22, 27, 34, 0.8)'; // surface
  const ratio = Math.min(value / max, 1);
  if (ratio <= 0.5) {
    // surface → cyan
    const t = ratio * 2;
    const r = Math.round(22 + (6 - 22) * t);
    const g = Math.round(27 + (182 - 27) * t);
    const b = Math.round(34 + (212 - 34) * t);
    return `rgba(${r}, ${g}, ${b}, ${0.3 + t * 0.5})`;
  }
  // cyan → magenta
  const t = (ratio - 0.5) * 2;
  const r = Math.round(6 + (217 - 6) * t);
  const g = Math.round(182 + (70 - 182) * t);
  const b = Math.round(212 + (239 - 212) * t);
  return `rgba(${r}, ${g}, ${b}, ${0.8 + t * 0.2})`;
}

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

/* ══════════════════════════════ COMPONENT ═════════════════════════════════ */

export default function PredictPage() {
  const [data, setData] = useState<PredictData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/intel/predict');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: PredictData = await res.json();
        if (!cancelled) setData(json);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
          Building prediction model…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="card text-sm text-danger">
          Failed to load predictions: {error || 'No data'}
        </div>
      </div>
    );
  }

  // Compute max intensity for heatmap color scaling
  const allValues = DISPLAY_DAYS.flatMap((day) =>
    DISPLAY_HOURS.map((h) => data.heatmap[day]?.[h.toString()] ?? 0)
  );
  const maxIntensity = Math.max(...allValues, 1);

  // Weekly pattern max for bar chart
  const weeklyMax = Math.max(...Object.values(data.weeklyPattern), 1);

  return (
    <div className="flex h-full flex-col gap-6 px-6 py-5">
      {/* Header */}
      <header>
        <h1 className="font-display text-xl font-bold tracking-tight">
          🔮 Predictive Scheduling
        </h1>
        <p className="text-2xs text-muted">
          21-day activity pattern analysis · Updated every 5 min
        </p>
      </header>

      {/* ─── Hero Heatmap ──────────────────────────────────────────── */}
      <section className="card">
        <div className="mb-3 flex items-center justify-between">
          <span className="stat-label">Activity Heatmap — Day × Hour</span>
          <div className="flex items-center gap-2 text-2xs text-muted">
            <span>Low</span>
            <div className="flex gap-0.5">
              {[0, 0.25, 0.5, 0.75, 1].map((r) => (
                <div
                  key={r}
                  className="h-3 w-5 rounded-sm"
                  style={{ backgroundColor: intensityColor(r * maxIntensity, maxIntensity) }}
                />
              ))}
            </div>
            <span>High</span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <div className="grid min-w-[600px]" style={{ gridTemplateColumns: '60px repeat(7, 1fr)' }}>
            {/* Column headers */}
            <div />
            {DISPLAY_DAYS.map((day) => (
              <div
                key={day}
                className={`px-1 pb-2 text-center text-2xs font-medium ${
                  day === data.busiestDay ? 'text-cyan' : 'text-muted'
                }`}
              >
                {day.slice(0, 3)}
              </div>
            ))}

            {/* Rows: one per hour */}
            {DISPLAY_HOURS.map((hour) => (
              <div key={hour} className="contents">
                <div className="flex items-center pr-2 text-right font-mono text-2xs text-muted">
                  {formatHour(hour)}
                </div>
                {DISPLAY_DAYS.map((day) => {
                  const value = data.heatmap[day]?.[hour.toString()] ?? 0;
                  const isPeak = data.prediction.tomorrow.day === day &&
                    data.prediction.tomorrow.peakHours.includes(hour);
                  return (
                    <div
                      key={`${day}-${hour}`}
                      className={`group relative m-0.5 flex items-center justify-center rounded-sm transition-transform hover:scale-110 ${
                        isPeak ? 'ring-1 ring-magenta/60' : ''
                      }`}
                      style={{
                        backgroundColor: intensityColor(value, maxIntensity),
                        height: '28px',
                      }}
                    >
                      {value > 0 && (
                        <span className="text-2xs font-medium text-fg/70">
                          {value}
                        </span>
                      )}
                      {/* Tooltip */}
                      <div className="pointer-events-none absolute -top-8 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded bg-surface-2 px-2 py-1 text-2xs text-fg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        {day.slice(0, 3)} {formatHour(hour)}: {value} avg events
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Bottom Grid: Forecast + Weekly + Staffing ─────────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Tomorrow Forecast Card */}
        <section className="card flex flex-col">
          <span className="stat-label mb-3">Tomorrow&apos;s Forecast</span>
          <div className="mb-3 flex items-center gap-2">
            <span className="text-3xl">📅</span>
            <div>
              <div className="font-display text-lg font-bold text-fg">
                {data.prediction.tomorrow.day}
              </div>
              <div className="text-2xs text-muted">
                Expected load: <span className="text-cyan font-medium">{data.prediction.tomorrow.expectedLoad}</span> events
              </div>
            </div>
          </div>
          <div className="space-y-2">
            <div>
              <span className="text-2xs text-muted">Peak hours:</span>
              <div className="mt-1 flex gap-1.5">
                {data.prediction.tomorrow.peakHours.map((h) => (
                  <span key={h} className="badge bg-magenta/15 text-magenta">
                    {formatHour(h)}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-3 rounded border border-border/50 bg-bg p-2">
              <span className="text-2xs text-muted">Compared to weekly avg:</span>
              <div className="mt-1 text-xs text-fg">
                {(() => {
                  const avgLoad = Object.values(data.weeklyPattern).reduce((s, v) => s + v, 0) / 7;
                  const diff = data.prediction.tomorrow.expectedLoad - avgLoad;
                  const pct = avgLoad > 0 ? Math.round((diff / avgLoad) * 100) : 0;
                  if (Math.abs(pct) < 5) return '≈ Average day expected';
                  return diff > 0
                    ? `↑ ${pct}% above average`
                    : `↓ ${Math.abs(pct)}% below average`;
                })()}
              </div>
            </div>
          </div>
        </section>

        {/* Weekly Pattern Bar Chart */}
        <section className="card flex flex-col">
          <span className="stat-label mb-3">Weekly Pattern</span>
          <div className="flex flex-1 items-end gap-1.5">
            {DISPLAY_DAYS.map((day) => {
              const value = data.weeklyPattern[day] ?? 0;
              const height = Math.max(4, (value / weeklyMax) * 100);
              const isBusiest = day === data.busiestDay;
              const isQuietest = day === data.quietestDay;
              return (
                <div
                  key={day}
                  className="group relative flex flex-1 flex-col items-center justify-end"
                  style={{ height: '140px' }}
                >
                  <div
                    className={`w-full rounded-t transition-all ${
                      isBusiest
                        ? 'bg-cyan'
                        : isQuietest
                        ? 'bg-muted/40'
                        : 'bg-cyan/60'
                    }`}
                    style={{ height: `${height}%` }}
                  />
                  <span className={`mt-1.5 text-2xs ${isBusiest ? 'text-cyan font-medium' : 'text-muted'}`}>
                    {day.slice(0, 3)}
                  </span>
                  {/* Tooltip */}
                  <div className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-surface-2 px-2 py-1 text-2xs text-fg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                    {day}: {value} avg events
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between text-2xs text-muted">
            <span>
              Busiest: <span className="text-cyan">{data.busiestDay}</span>
            </span>
            <span>
              Quietest: <span className="text-fg">{data.quietestDay}</span>
            </span>
          </div>
        </section>

        {/* Staffing Suggestions */}
        <section className="card flex flex-col">
          <span className="stat-label mb-3">Staffing Suggestions</span>
          <div className="space-y-3 text-xs text-fg">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-base">🟢</span>
              <div>
                <p className="font-medium">Peak Coverage</p>
                <p className="text-2xs text-muted">
                  Ensure full staffing on <span className="text-cyan">{data.busiestDay}s</span> during{' '}
                  {data.busiestHours.map(formatHour).join(', ')}.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-base">🟡</span>
              <div>
                <p className="font-medium">Low-Traffic Windows</p>
                <p className="text-2xs text-muted">
                  <span className="text-fg">{data.quietestDay}s</span> at{' '}
                  {data.quietestHours.map(formatHour).join(', ')} are consistently quiet — ideal for
                  training, admin, or reduced staffing.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-base">🔮</span>
              <div>
                <p className="font-medium">Tomorrow</p>
                <p className="text-2xs text-muted">
                  {data.prediction.tomorrow.day} peak expected at{' '}
                  <span className="text-magenta">
                    {data.prediction.tomorrow.peakHours.map(formatHour).join(', ')}
                  </span>
                  . Schedule key advisors for those windows.
                </p>
              </div>
            </div>
            <div className="mt-2 rounded border border-cyan/20 bg-cyan/5 p-2 text-2xs text-muted">
              💡 Based on 21 days of observed activity patterns across {Object.values(data.weeklyPattern).reduce((s, v) => s + v, 0)} total
              tracked events.
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
