/**
 * Relative Time Formatting (client-safe)
 * ====================================
 * Shared with the customer tracker. Pure JS — no Node imports — so it's safe in
 * client components (the board renders "in stage 12 min" on each card).
 */

/**
 * Format an ISO timestamp as a short relative string from `now`.
 *
 * @param iso  ISO-8601 timestamp (e.g. repair_orders.updated_at).
 * @param now  Reference time in ms (defaults to Date.now()); injectable for tests.
 * @returns    "just now", "12 min", "3 hr", or "2 days".
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor(diffMs / 1000));

  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
