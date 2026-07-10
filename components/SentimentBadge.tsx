/**
 * SentimentBadge — colored pill showing customer sentiment
 * ========================================================
 * Renders a compact badge with a color-coded background matching the sentiment:
 *   positive   → green
 *   neutral    → gray
 *   concerned  → amber
 *   frustrated → red
 *
 * Used inline on the audio/transcript page to show overall call sentiment at a
 * glance. Accepts an optional score to render the numeric value alongside.
 */
'use client';

import type { SentimentLabel } from '@/lib/sentiment';

const BADGE_STYLES: Record<SentimentLabel, string> = {
  positive: 'bg-ok/15 text-ok',
  neutral: 'bg-muted/15 text-muted',
  concerned: 'bg-warn/15 text-warn',
  frustrated: 'bg-danger/15 text-danger',
};

const LABELS: Record<SentimentLabel, string> = {
  positive: 'Positive',
  neutral: 'Neutral',
  concerned: 'Concerned',
  frustrated: 'Frustrated',
};

export default function SentimentBadge({
  label,
  score,
  className = '',
}: {
  label: SentimentLabel;
  score?: number;
  className?: string;
}) {
  const style = BADGE_STYLES[label] ?? BADGE_STYLES.neutral;
  const displayLabel = LABELS[label] ?? 'Unknown';

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${style} ${className}`}
      aria-label={`Customer sentiment: ${displayLabel}${score != null ? ` (${score.toFixed(2)})` : ''}`}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
      {displayLabel}
      {score != null && (
        <span className="font-mono text-2xs opacity-75">{score.toFixed(2)}</span>
      )}
    </span>
  );
}
