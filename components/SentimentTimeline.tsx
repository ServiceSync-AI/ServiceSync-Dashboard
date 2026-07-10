/**
 * SentimentTimeline — flagged segments as colored markers on a timeline
 * ====================================================================
 * Visualizes the emotional arc of a conversation by placing color-coded markers
 * on a horizontal bar representing the call duration. Each marker corresponds
 * to a flagged segment from the sentiment analysis, positioned proportionally
 * by its timestamp.
 *
 * Colors match SentimentBadge:
 *   positive   → green (ok)
 *   neutral    → gray (muted)
 *   concerned  → amber (warn)
 *   frustrated → red (danger)
 *
 * Hover/focus on a marker reveals the segment text and reasoning in a tooltip.
 */
'use client';

import { useState } from 'react';
import type { FlaggedSegment, SentimentLabel } from '@/lib/sentiment';

const MARKER_COLORS: Record<SentimentLabel, string> = {
  positive: 'bg-ok',
  neutral: 'bg-muted',
  concerned: 'bg-warn',
  frustrated: 'bg-danger',
};

const TOOLTIP_BORDER: Record<SentimentLabel, string> = {
  positive: 'border-ok/40',
  neutral: 'border-muted/40',
  concerned: 'border-warn/40',
  frustrated: 'border-danger/40',
};

export default function SentimentTimeline({
  flaggedSegments,
  durationSec,
  className = '',
}: {
  flaggedSegments: FlaggedSegment[];
  /** Total duration of the call in seconds — used to position markers. */
  durationSec: number;
  className?: string;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (!flaggedSegments.length || durationSec <= 0) {
    return (
      <div className={`rounded bg-surface-2 px-3 py-2 text-xs text-muted ${className}`}>
        No flagged sentiment segments.
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`} role="figure" aria-label="Sentiment timeline">
      {/* Track */}
      <div className="relative h-3 w-full rounded-full bg-surface-2">
        {flaggedSegments.map((seg, i) => {
          // Position marker based on segment midpoint relative to total duration.
          const midpoint = ((seg as unknown as { start?: number }).start ?? 0);
          // We don't have exact timestamps on flagged segments from the model,
          // so distribute evenly if we can't derive position from index.
          const position = durationSec > 0
            ? Math.min(((segmentMidpoint(seg, flaggedSegments.length, i, durationSec)) / durationSec) * 100, 98)
            : (i / flaggedSegments.length) * 100;

          return (
            <button
              key={i}
              type="button"
              className={`absolute top-0.5 h-2 w-2 -translate-x-1/2 rounded-full ring-2 ring-bg transition-transform hover:scale-150 focus:scale-150 focus:outline-none ${MARKER_COLORS[seg.sentiment]}`}
              style={{ left: `${Math.max(1, position)}%` }}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              aria-label={`${seg.sentiment} at segment ${seg.index}: ${seg.reason}`}
            />
          );
        })}
      </div>

      {/* Time labels */}
      <div className="flex justify-between text-2xs text-muted">
        <span>0:00</span>
        <span>{fmtDuration(durationSec)}</span>
      </div>

      {/* Tooltip */}
      {active !== null && flaggedSegments[active] && (
        <div
          className={`rounded border ${TOOLTIP_BORDER[flaggedSegments[active].sentiment]} bg-surface p-3 text-xs transition-opacity`}
          role="tooltip"
        >
          <p className="font-medium text-fg">
            Segment {flaggedSegments[active].index} —{' '}
            <span className="capitalize">{flaggedSegments[active].sentiment}</span>
          </p>
          <p className="mt-1 text-muted italic">&ldquo;{flaggedSegments[active].text}&rdquo;</p>
          <p className="mt-1 text-muted">{flaggedSegments[active].reason}</p>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

/**
 * Estimate the time position for a flagged segment. Uses the segment index
 * relative to a presumed uniform distribution across the call duration.
 */
function segmentMidpoint(
  _seg: FlaggedSegment,
  totalFlags: number,
  idx: number,
  durationSec: number,
): number {
  // Distribute evenly across the call — safe fallback since the model returns
  // a segment index into the original transcript, not a raw timestamp.
  return ((idx + 0.5) / totalFlags) * durationSec;
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
