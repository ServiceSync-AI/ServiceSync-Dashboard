'use client';
/**
 * RecoveryDatePicker — scope the recovery pass to a day (or most-recent)
 * =====================================================================
 * A dark-theme <input type="date"> that reloads the recovery page with
 * `?day=YYYY-MM-DD`. Clearing it (via "Most recent") drops the param and returns
 * to the default most-recent-transcripts mode. The active mode is shown so it's
 * always clear whether you're looking at "today's recent" vs a specific day.
 */
import { useRouter, usePathname } from 'next/navigation';
import { useState, useTransition } from 'react';

export default function RecoveryDatePicker({ day }: { day: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(day ?? '');

  function go(nextDay: string) {
    setValue(nextDay);
    const url = nextDay ? `${pathname}?day=${nextDay}` : pathname;
    startTransition(() => router.push(url));
  }

  // Cap the picker at today (UTC) — no future days to analyze.
  const maxDay = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-2xs text-muted">
        Mode:{' '}
        <span className="font-mono text-fg">
          {day ? `day ${day}` : 'most recent'}
        </span>
      </span>
      <input
        type="date"
        value={value}
        max={maxDay}
        onChange={(e) => go(e.target.value)}
        disabled={isPending}
        aria-label="Analyze a specific day"
        className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-fg [color-scheme:dark] focus:border-cyan focus:outline-none disabled:opacity-50"
      />
      {day && (
        <button
          onClick={() => go('')}
          disabled={isPending}
          className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-muted/60 hover:text-fg disabled:opacity-50"
        >
          Most recent
        </button>
      )}
    </div>
  );
}
