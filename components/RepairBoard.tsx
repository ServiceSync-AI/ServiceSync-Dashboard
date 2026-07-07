'use client';

/**
 * RepairBoard — the live, advisor-facing repair board
 * ====================================
 * Kanban of active repair orders for one dealership, one swimlane per stage.
 * Advancing a card calls the console's POST /api/advance (→ tracker
 * /api/update), so the customer tracker updates and the SMS fires on the same
 * canonical path the extension uses.
 *
 * Real-time: Phase 1 polls every POLL_MS. The poll + the per-card advance are
 * deliberately isolated behind /api/orders and /api/advance, so swapping in
 * AppSync/WebSocket push later is a drop-in replacement for the poll only.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoardOrder } from '@/lib/console/types';
import {
  BOARD_COLUMNS,
  STATUS_ACCENT,
  STATUS_LABELS,
  advanceLabel,
  nextStatus,
} from '@/lib/console/statuses';
import { timeAgo } from '@/lib/console/time';

const POLL_MS = 15_000;

interface Props {
  initialOrders: BoardOrder[];
  dealershipId: string;
  dealershipName: string;
}

export default function RepairBoard({ initialOrders, dealershipId, dealershipName }: Props) {
  const [orders, setOrders] = useState<BoardOrder[]>(initialOrders);
  const [advancing, setAdvancing] = useState<Set<string>>(new Set());
  const [lastSync, setLastSync] = useState<number>(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  // Re-render once a second so the "in stage 12 min" labels stay current.
  const [, setTick] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/console/orders?dealership_id=${encodeURIComponent(dealershipId)}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`board ${res.status}`);
      const data = (await res.json()) as { orders: BoardOrder[] };
      if (!mounted.current) return;
      setOrders(data.orders);
      setLastSync(Date.now());
      setError(null);
    } catch {
      if (mounted.current) setError('Reconnecting…');
    }
  }, [dealershipId]);

  // Poll for live updates; tick the clock for relative-time labels.
  useEffect(() => {
    const poll = setInterval(refresh, POLL_MS);
    const clock = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
    };
  }, [refresh]);

  const advance = useCallback(
    async (order: BoardOrder) => {
      const next = nextStatus(order.status);
      if (!next) return;
      setAdvancing((prev) => new Set(prev).add(order.tracking_code));
      // Optimistic: move the card immediately; reconcile on the next poll.
      setOrders((prev) =>
        prev.map((o) =>
          o.tracking_code === order.tracking_code
            ? { ...o, status: next, updated_at: new Date().toISOString() }
            : o,
        ),
      );
      try {
        const res = await fetch('/api/console/advance', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ tracking_code: order.tracking_code, status: next }),
        });
        if (!res.ok) throw new Error(`advance ${res.status}`);
        await refresh();
      } catch {
        // Roll back the optimistic move and resync from the source of truth.
        setError('Update failed — retrying from server');
        await refresh();
      } finally {
        if (mounted.current) {
          setAdvancing((prev) => {
            const nextSet = new Set(prev);
            nextSet.delete(order.tracking_code);
            return nextSet;
          });
        }
      }
    },
    [refresh],
  );

  const active = orders.filter((o) => o.status !== 'picked_up');
  const pickedUp = orders.filter((o) => o.status === 'picked_up');
  const readyCount = orders.filter((o) => o.status === 'ready').length;

  return (
    <div className="flex h-[100dvh] flex-col">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-5 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Repair Board</h1>
          <p className="text-sm text-muted">{dealershipName}</p>
        </div>
        <div className="ml-auto flex items-center gap-5 text-sm">
          <span className="text-muted">
            <span className="font-semibold text-ink">{active.length}</span> active
          </span>
          {readyCount > 0 && (
            <span className="rounded-full bg-[#22c55e]/15 px-2.5 py-1 font-medium text-[#22c55e]">
              {readyCount} ready for pickup
            </span>
          )}
          <span className="flex items-center gap-2 text-muted" title={`Last synced ${timeAgo(new Date(lastSync).toISOString())} ago`}>
            <span
              className={`h-2 w-2 rounded-full ${error ? 'bg-magenta' : 'bg-cyan animate-pulse-glow'}`}
            />
            {error ?? 'Live'}
          </span>
        </div>
      </header>

      {/* ── Board ──────────────────────────────────────────────── */}
      <div className="flex flex-1 gap-4 overflow-x-auto p-5">
        {BOARD_COLUMNS.map((status) => {
          const lane = active.filter((o) => o.status === status);
          return (
            <section
              key={status}
              className="flex w-72 shrink-0 flex-col rounded-xl bg-surface/60"
            >
              <div
                className="flex items-center justify-between rounded-t-xl border-b-2 px-3 py-2.5"
                style={{ borderColor: STATUS_ACCENT[status] }}
              >
                <h2 className="text-sm font-semibold">{STATUS_LABELS[status]}</h2>
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                  {lane.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-2">
                {lane.length === 0 && (
                  <p className="px-1 py-6 text-center text-xs text-muted/60">Empty</p>
                )}
                {lane.map((order) => (
                  <OrderCard
                    key={order.tracking_code}
                    order={order}
                    busy={advancing.has(order.tracking_code)}
                    onAdvance={() => advance(order)}
                  />
                ))}
              </div>
            </section>
          );
        })}

        {/* Collapsed "done today" lane. */}
        {pickedUp.length > 0 && (
          <section className="flex w-56 shrink-0 flex-col rounded-xl bg-surface/30">
            <div className="flex items-center justify-between border-b-2 border-border px-3 py-2.5">
              <h2 className="text-sm font-semibold text-muted">Picked Up</h2>
              <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-muted">
                {pickedUp.length}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-2">
              {pickedUp.map((order) => (
                <div
                  key={order.tracking_code}
                  className="rounded-lg bg-surface/50 px-3 py-2 text-xs text-muted"
                >
                  <div className="truncate text-ink/80">{order.vehicle}</div>
                  <div className="truncate">{order.customer_name ?? order.tracking_code}</div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/** A single repair-order card with its advance control. */
function OrderCard({
  order,
  busy,
  onAdvance,
}: {
  order: BoardOrder;
  busy: boolean;
  onAdvance: () => void;
}) {
  const label = advanceLabel(order.status);
  return (
    <article
      className="rounded-lg border-l-2 bg-surface px-3 py-2.5 shadow-sm"
      style={{ borderColor: STATUS_ACCENT[order.status] }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-ink">{order.vehicle}</h3>
        {order.ro_number && (
          <span className="shrink-0 text-[11px] text-muted">RO {order.ro_number}</span>
        )}
      </div>
      <p className="mt-0.5 truncate text-xs text-muted">
        {order.customer_name ?? 'Customer'}
        {order.phone_last4 ? ` · ${order.phone_last4}` : ''}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted/80" title={`Tracking ${order.tracking_code}`}>
          in stage {timeAgo(order.updated_at)}
        </span>
        {label && (
          <button
            type="button"
            onClick={onAdvance}
            disabled={busy}
            className="rounded-md bg-cyan/15 px-2.5 py-1 text-xs font-medium text-cyan transition hover:bg-cyan/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? '…' : label}
          </button>
        )}
      </div>
    </article>
  );
}
