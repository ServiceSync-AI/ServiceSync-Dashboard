/**
 * Formatting utilities — shared display helpers
 * =============================================
 * Pure functions for rendering bytes, durations, and relative timestamps the
 * same way everywhere. Kept framework-agnostic so both server and client code
 * can import them.
 */

/** Human-readable byte size, e.g. 1536000 -> "1.5 MB". */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/** Seconds -> "H:MM:SS" or "M:SS". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Minutes -> "Xh Ym" or "Ym". */
export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Relative time like "3h ago" / "just now" / "2d ago".
 * Returns "—" for missing/invalid input.
 */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '—';
  const diffSec = Math.round((now - then) / 1000);
  if (diffSec < 0) return 'in the future';
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return '1m ago';
  const mins = Math.round(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** Absolute timestamp for tooltips: "Jun 19, 2026 14:07 UTC". */
export function absoluteTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return (
    d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }) + ' UTC'
  );
}

/** "HH:MM" clock label in UTC for timelines. */
export function clockUTC(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toISOString().slice(11, 16);
}

/** YYYY-MM-DD for "today" in UTC. */
export function todayUTC(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}
