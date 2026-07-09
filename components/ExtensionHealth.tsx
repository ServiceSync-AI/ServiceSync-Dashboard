'use client';

/**
 * ExtensionHealth — Extension Uptime Monitor card
 * ================================================
 * Client component that fetches /api/intel/uptime and displays:
 * - Uptime % for today (business hours 8AM-6PM)
 * - Last event received timestamp
 * - Gaps >30min list
 * - Visual timeline bar (8AM-6PM) with green=active, red=gap
 */
import { useEffect, useState } from 'react';

interface Gap {
  start: string;
  end: string;
  durationMin: number;
}

interface UptimeData {
  uptimePercent: number;
  lastEvent: string | null;
  gaps: Gap[];
  businessMinutes: number;
  activeMinutes: number;
  eventsCount: number;
}

/** Format a timestamp to HH:MM (ET — assumes UTC-4 for display). */
function toET(iso: string): string {
  const d = new Date(iso);
  // Display in ET (UTC-4)
  const et = new Date(d.getTime() - 4 * 60 * 60 * 1000);
  return et.toISOString().slice(11, 16);
}

/** Timeline bar constants — maps to 8AM–6PM (10 hours). */
const BIZ_START_HOUR_UTC = 12; // 8AM ET = 12 UTC
const BIZ_END_HOUR_UTC = 22; // 6PM ET = 22 UTC
const TIMELINE_MINUTES = 600;

function TimelineBar({ gaps, date }: { gaps: Gap[]; date: string }) {
  const bizStart = new Date(`${date}T${String(BIZ_START_HOUR_UTC).padStart(2, '0')}:00:00.000Z`).getTime();

  // Convert gaps to pixel positions (percentage of timeline bar)
  const gapSegments = gaps.map((g) => {
    const startOffset = Math.max(0, (new Date(g.start).getTime() - bizStart) / 60_000);
    const endOffset = Math.min(TIMELINE_MINUTES, (new Date(g.end).getTime() - bizStart) / 60_000);
    return {
      leftPct: (startOffset / TIMELINE_MINUTES) * 100,
      widthPct: ((endOffset - startOffset) / TIMELINE_MINUTES) * 100,
    };
  });

  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-2xs text-muted">
        <span>8AM</span>
        <span>10AM</span>
        <span>12PM</span>
        <span>2PM</span>
        <span>4PM</span>
        <span>6PM</span>
      </div>
      <div className="relative h-4 w-full overflow-hidden rounded bg-ok/30">
        {gapSegments.map((seg, i) => (
          <div
            key={i}
            className="absolute inset-y-0 bg-danger/60"
            style={{ left: `${seg.leftPct}%`, width: `${seg.widthPct}%` }}
          />
        ))}
        {/* Current time marker */}
        {(() => {
          const now = Date.now();
          const offset = (now - bizStart) / 60_000;
          if (offset > 0 && offset < TIMELINE_MINUTES) {
            const pct = (offset / TIMELINE_MINUTES) * 100;
            return (
              <div
                className="absolute inset-y-0 w-0.5 bg-fg/70"
                style={{ left: `${pct}%` }}
              />
            );
          }
          return null;
        })()}
      </div>
      <div className="mt-1 flex justify-between text-2xs text-muted">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-ok/50" /> Active
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-danger/60" /> Gap (&gt;30m)
        </span>
      </div>
    </div>
  );
}

export default function ExtensionHealth() {
  const [data, setData] = useState<UptimeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetch(`/api/intel/uptime?date=${today}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<UptimeData>;
      })
      .then(setData)
      .catch((err) => setError(String(err.message)))
      .finally(() => setLoading(false));
  }, [today]);

  if (loading) {
    return (
      <div className="card animate-pulse">
        <span className="stat-label">Extension Health</span>
        <div className="mt-2 h-20 rounded bg-surface-2" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-l-2 border-l-warn">
        <span className="stat-label">Extension Health</span>
        <p className="mt-2 text-xs text-muted">Unable to load uptime data: {error}</p>
      </div>
    );
  }

  if (!data) return null;

  const tone =
    data.uptimePercent >= 90 ? 'ok' : data.uptimePercent >= 70 ? 'warn' : 'danger';
  const toneColor =
    tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : 'text-danger';

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="stat-label">Extension Health</span>
        <span className={`dot bg-${tone}`} aria-hidden />
      </div>

      <div className="mt-2 flex items-baseline gap-3">
        <span className={`font-display text-2xl font-bold ${toneColor}`}>
          {data.uptimePercent}%
        </span>
        <span className="text-2xs text-muted">
          uptime today · {data.eventsCount} events in business hours
        </span>
      </div>

      {data.lastEvent && (
        <div className="mt-1 text-2xs text-muted">
          Last event: {toET(data.lastEvent)} ET ({new Date(data.lastEvent).toISOString().slice(11, 19)} UTC)
        </div>
      )}

      <TimelineBar gaps={data.gaps} date={today} />

      {data.gaps.length > 0 && (
        <div className="mt-3">
          <span className="text-2xs font-semibold text-muted">
            Gaps ({data.gaps.length}):
          </span>
          <div className="mt-1 space-y-1">
            {data.gaps.map((g, i) => (
              <div key={i} className="flex items-center gap-2 text-2xs">
                <span className="text-danger">●</span>
                <span className="text-fg/80">
                  {toET(g.start)}–{toET(g.end)} ET
                </span>
                <span className="text-muted">({g.durationMin}min)</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
