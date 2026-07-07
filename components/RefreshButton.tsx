/**
 * RefreshButton — re-run a server component's data fetch
 * ======================================================
 * Pages are server-rendered at request time and otherwise static; this gives
 * the user an explicit "pull fresh data" control via router.refresh(). Shows a
 * spinner during the refresh and the time of the last load.
 */
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export default function RefreshButton({ generatedAt }: { generatedAt?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [spinning, setSpinning] = useState(false);

  function refresh() {
    setSpinning(true);
    startTransition(() => {
      router.refresh();
      // Brief visual feedback even if the refresh resolves instantly.
      setTimeout(() => setSpinning(false), 600);
    });
  }

  return (
    <div className="flex items-center gap-3">
      {generatedAt && (
        <span className="font-mono text-2xs text-muted">loaded {generatedAt}</span>
      )}
      <button
        onClick={refresh}
        disabled={isPending}
        className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-muted transition-colors hover:border-muted/60 hover:text-fg disabled:opacity-50"
      >
        <span className={spinning ? 'animate-spin' : ''} aria-hidden>
          ↻
        </span>
        Refresh
      </button>
    </div>
  );
}
