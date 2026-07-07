'use client';

/**
 * TrackerClient — the live customer tracker view
 * ====================================
 * Fetches GET /api/status for a tracking code and re-polls every 30 seconds so
 * the customer sees stage changes without refreshing. Renders the vehicle card,
 * the five-dot tracker, the rewards banner, advisor/contact info, and — once the
 * car is ready — confetti plus the review/call CTAs.
 */
import { useCallback, useEffect, useState } from 'react';
import VehicleCard from './VehicleCard';
import StepTracker from './StepTracker';
import RewardsBanner from './RewardsBanner';
import ReadyActions from './ReadyActions';
import Confetti from './Confetti';
import { STATUS_LABELS, isComplete } from '@/lib/tracker/statuses';
import { timeAgo } from '@/lib/tracker/time';
import type { TrackerView } from '@/lib/tracker/types';

// Poll cadence for status updates (ms). 30s per spec — frequent enough to feel
// live, infrequent enough to stay cheap at dealership scale.
const POLL_INTERVAL_MS = 30_000;

type LoadState = 'loading' | 'ok' | 'not_found' | 'error';

export default function TrackerClient({ code }: { code: string }) {
  const [view, setView] = useState<TrackerView | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/tracker/status?code=${encodeURIComponent(code)}`, {
        cache: 'no-store',
      });
      if (res.status === 404) {
        setState('not_found');
        return;
      }
      if (!res.ok) {
        setState('error');
        return;
      }
      const data: TrackerView = await res.json();
      setView(data);
      setState('ok');
    } catch {
      setState('error');
    }
  }, [code]);

  // Initial load + 30s polling. Cleared on unmount.
  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  if (state === 'loading') {
    return <CenteredMessage title="Loading…" />;
  }

  if (state === 'not_found') {
    return (
      <CenteredMessage
        title="Tracker not found"
        body="This tracking link may be expired or incorrect. Check the link in your text message."
      />
    );
  }

  if (state === 'error' || !view) {
    return (
      <CenteredMessage
        title="Something went wrong"
        body="We couldn't load your repair status. Please try again in a moment."
      />
    );
  }

  const complete = isComplete(view.status);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-4 py-6">
      {complete && <Confetti />}

      <VehicleCard view={view} />

      {/* Current stage + relative time. */}
      <section className="rounded-2xl border border-border bg-surface p-5">
        <p className="text-xs uppercase tracking-wide text-muted">Currently</p>
        <p className="mt-1 font-heading text-xl font-bold text-cyan">
          {STATUS_LABELS[view.status]}
        </p>
        <p className="mt-1 text-xs text-muted">Updated {timeAgo(view.updated_at)}</p>

        <div className="mt-6">
          <StepTracker status={view.status} />
        </div>
      </section>

      <RewardsBanner rewards={view.rewards} />

      {complete && <ReadyActions dealership={view.dealership} />}

      {/* Advisor + dealership contact. */}
      <footer className="rounded-2xl border border-border bg-surface p-5 text-sm">
        {view.advisor_name && (
          <p className="text-ink">
            Your advisor: <span className="font-medium">{view.advisor_name}</span>
          </p>
        )}
        {view.dealership.phone && (
          <p className="mt-1 text-muted">
            Questions?{' '}
            <a href={`tel:${view.dealership.phone}`} className="text-cyan hover:underline">
              Call {view.dealership.name}
            </a>
          </p>
        )}
      </footer>

      <p className="pb-4 text-center text-[11px] text-muted">
        Powered by ServiceSync
      </p>
    </main>
  );
}

/** Centered single-message layout for loading/error/empty states. */
function CenteredMessage({ title, body }: { title: string; body?: string }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <h1 className="font-heading text-xl font-bold text-ink">{title}</h1>
      {body && <p className="mt-2 max-w-xs text-sm text-muted">{body}</p>}
    </main>
  );
}
