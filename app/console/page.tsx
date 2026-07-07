/**
 * Advisor Console — home (the repair board)
 * ====================================
 * Server component: resolves the dealership (Phase 1 = ?dealership or
 * DEFAULT_DEALERSHIP_ID; Cognito-bound later), server-fetches the initial board
 * so first paint is populated, then hands off to the live <RepairBoard/>.
 *
 * If the tracker API isn't configured/reachable we render a clear setup card
 * instead of crashing — useful before TRACKER_API_BASE_URL/KEY are wired.
 */
import RepairBoard from '@/components/RepairBoard';
import { fetchOrders } from '@/lib/console/tracker';
import { toBoardOrder } from '@/lib/console/board';

export const dynamic = 'force-dynamic';

/** "chevyland" → "Chevyland" — a friendly header name until Cognito carries one. */
function humanize(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

export default async function Page({
  searchParams,
}: {
  searchParams: { dealership?: string };
}) {
  const dealershipId =
    searchParams.dealership?.trim() || process.env.DEFAULT_DEALERSHIP_ID || 'chevyland';

  try {
    const orders = await fetchOrders(dealershipId);
    return (
      <RepairBoard
        initialOrders={orders.map(toBoardOrder)}
        dealershipId={dealershipId}
        dealershipName={humanize(dealershipId)}
      />
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return (
      <main className="flex min-h-[100dvh] items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-border bg-surface p-6">
          <h1 className="text-lg font-semibold">Console not connected</h1>
          <p className="mt-2 text-sm text-muted">
            Couldn&apos;t reach the customer-tracker API. Set{' '}
            <code className="text-cyan">TRACKER_API_BASE_URL</code> and{' '}
            <code className="text-cyan">TRACKER_API_KEY</code>, then reload.
          </p>
          <p className="mt-3 text-xs text-muted/70">{message}</p>
        </div>
      </main>
    );
  }
}
