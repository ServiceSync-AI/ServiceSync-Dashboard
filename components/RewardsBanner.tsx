/**
 * RewardsBanner — loyalty progress bar
 * ====================================
 * Shows points toward the next reward, e.g. "150 / 500 points — next reward:
 * Free Oil Change", with a shimmering progress bar.
 */
import type { TrackerView } from '@/lib/tracker/types';

interface RewardsBannerProps {
  rewards: TrackerView['rewards'];
}

export default function RewardsBanner({ rewards }: RewardsBannerProps) {
  const { points, threshold, reward_name } = rewards;

  // Progress toward the current reward tier. Clamp to [0,100] so over-threshold
  // balances (a returning customer) still render a full, valid bar.
  const pct = threshold > 0 ? Math.min(100, Math.round((points / threshold) * 100)) : 0;
  const earned = points >= threshold;
  const remaining = Math.max(0, threshold - points);

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-baseline justify-between">
        <span className="font-heading text-sm font-semibold text-ink">Rewards</span>
        <span className="text-sm text-muted">
          {points} / {threshold} pts
        </span>
      </div>

      {/* Progress bar. */}
      <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-gradient-to-r from-cyan via-violet to-magenta bg-[length:200%_100%] animate-shimmer transition-[width] duration-700"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={points}
          aria-valuemin={0}
          aria-valuemax={threshold}
        />
      </div>

      <p className="mt-3 text-sm text-muted">
        {earned ? (
          <span className="font-medium text-cyan">
            You&apos;ve earned a {reward_name}! 🎁
          </span>
        ) : (
          <>
            <span className="font-medium text-ink">{remaining} pts</span> to your next reward:{' '}
            <span className="font-medium text-cyan">{reward_name}</span>
          </>
        )}
      </p>
    </section>
  );
}
