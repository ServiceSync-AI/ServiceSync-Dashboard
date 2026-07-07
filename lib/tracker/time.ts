/**
 * Relative Time Formatting (client-safe)
 * ====================================
 * Tiny helper for the "Updated 12 min ago" line. Pure JS — no Node imports — so
 * it's safe in client components.
 */

/**
 * Format an ISO timestamp as a short relative string from `now`.
 *
 * @param iso  ISO-8601 timestamp (e.g. repair_orders.updated_at).
 * @param now  Reference time in ms (defaults to Date.now()); injectable for tests.
 * @returns    "just now", "12 min ago", "3 hr ago", or "2 days ago".
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diffMs = now - new Date(iso).getTime();
  const seconds = Math.max(0, Math.floor(diffMs / 1000));

  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}
