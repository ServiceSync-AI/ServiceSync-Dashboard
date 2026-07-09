'use client';

/**
 * RecoveryStatusButtons — Mark as Recovered / Lost
 * =================================================
 * Client component that calls PATCH /api/intel/recovery to update the
 * recovery_status of an outreach record. Shows current status if already set,
 * or action buttons if pending.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

interface Props {
  advisorId: string;
  ts: string;
  currentStatus?: 'recovered' | 'lost' | 'pending' | null;
  estDollars?: number | null;
}

export default function RecoveryStatusButtons({ advisorId, ts, currentStatus, estDollars }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<string | null>(currentStatus ?? null);
  const [error, setError] = useState<string | null>(null);

  async function markStatus(newStatus: 'recovered' | 'lost') {
    setError(null);
    try {
      const res = await fetch('/api/intel/recovery', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: ts,
          advisor_id: advisorId,
          status: newStatus,
          recovered_amount: newStatus === 'recovered' ? estDollars : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setStatus(newStatus);
      startTransition(() => router.refresh());
    } catch (err) {
      setError(String((err as Error).message));
    }
  }

  if (status === 'recovered') {
    return (
      <span className="badge bg-ok/15 text-ok">✓ Recovered</span>
    );
  }
  if (status === 'lost') {
    return (
      <span className="badge bg-danger/15 text-danger">✗ Lost</span>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-2">
      <button
        onClick={() => markStatus('recovered')}
        disabled={isPending}
        className="rounded bg-ok/20 px-2 py-1 text-2xs font-semibold text-ok transition-colors hover:bg-ok/30 disabled:opacity-50"
      >
        {isPending ? '…' : '✓ Mark Recovered'}
      </button>
      <button
        onClick={() => markStatus('lost')}
        disabled={isPending}
        className="rounded bg-danger/20 px-2 py-1 text-2xs font-semibold text-danger transition-colors hover:bg-danger/30 disabled:opacity-50"
      >
        {isPending ? '…' : '✗ Mark Lost'}
      </button>
      {error && <span className="text-2xs text-danger">{error}</span>}
    </div>
  );
}
