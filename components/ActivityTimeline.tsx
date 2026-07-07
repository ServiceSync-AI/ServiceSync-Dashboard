/**
 * ActivityTimeline — a day on one horizontal track
 * ================================================
 * Lays sessions out across a 24-hour track, each block positioned by its
 * start/end and colored by the system the advisor spent most time in. Gaps =
 * idle. Rapid-switch sessions get a warning tick so friction is visible at a
 * glance. Hover a block for its details.
 */
'use client';

import { useMemo } from 'react';
import { colorForLabel } from '@/lib/colors';
import { clockUTC, formatDuration } from '@/lib/format';
import type { ActivitySession } from '@/lib/types';

const HOURS = Array.from({ length: 25 }, (_, i) => i);

/** Minutes-into-UTC-day for an ISO timestamp (0–1440). */
function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

export default function ActivityTimeline({
  sessions,
}: {
  sessions: ActivitySession[];
}) {
  const blocks = useMemo(
    () =>
      sessions.map((s) => {
        const startMin = minuteOfDay(s.start);
        const endMin = Math.min(1440, startMin + s.durationSec / 60);
        return {
          session: s,
          left: (startMin / 1440) * 100,
          width: Math.max(0.4, ((endMin - startMin) / 1440) * 100),
          color: colorForLabel(s.systems[0] ?? 'Other'),
        };
      }),
    [sessions],
  );

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <span className="stat-label">Activity timeline (UTC)</span>
        <span className="text-2xs text-muted">{sessions.length} sessions</span>
      </div>

      <div className="relative h-12 w-full rounded bg-bg">
        {/* Hour gridlines */}
        {HOURS.map((h) => (
          <div
            key={h}
            className="absolute top-0 h-full border-l border-border/40"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}
        {/* Session blocks */}
        {blocks.map((b, i) => (
          <div
            key={i}
            title={`${clockUTC(b.session.start)} · ${formatDuration(
              b.session.durationSec,
            )} · ${b.session.systems.join(', ')} · ${b.session.switches} switches`}
            className="group absolute top-2 h-8 rounded-sm"
            style={{
              left: `${b.left}%`,
              width: `${b.width}%`,
              backgroundColor: b.color,
              opacity: 0.85,
            }}
          >
            {b.session.rapidSwitch && (
              <span className="absolute -top-1 right-0 h-2 w-2 rounded-full bg-danger ring-2 ring-bg" />
            )}
          </div>
        ))}
      </div>

      {/* Hour labels every 3h */}
      <div className="relative mt-1 h-4 w-full">
        {HOURS.filter((h) => h % 3 === 0).map((h) => (
          <span
            key={h}
            className="absolute -translate-x-1/2 font-mono text-2xs text-muted"
            style={{ left: `${(h / 24) * 100}%` }}
          >
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}
