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

// ─── Dealership timezone (Shreveport, LA = Central) ─────────────────────────

const DEALERSHIP_TZ = 'America/Chicago';

/**
 * Format an ISO timestamp to Central Time clock: "9:37 AM" or "2:15 PM".
 * Falls back to UTC if timezone formatting fails.
 */
export function clockCentral(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: DEALERSHIP_TZ,
  });
}

/**
 * Parse a recording filename like "20260721_093724.mp3" into a friendly
 * Central Time label: "9:37 AM" — using the embedded timestamp (which is
 * already in the advisor PC's local time = Central).
 */
export function filenameToCentralTime(filename: string): string {
  const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return filename;
  const [, , , , hh, mm] = match;
  const hour = parseInt(hh, 10);
  const minute = mm;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h12}:${minute} ${ampm}`;
}

/**
 * Parse filename into a fuller label: "Jul 21 · 9:37 AM".
 */
export function filenameToLabel(filename: string): string {
  const match = filename.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!match) return filename;
  const [, year, month, day, hh, mm] = match;
  const hour = parseInt(hh, 10);
  const minute = mm;
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const h12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthName = months[parseInt(month, 10) - 1] || month;
  return `${monthName} ${parseInt(day, 10)} · ${h12}:${minute} ${ampm}`;
}

/**
 * Estimate recording duration from file size.
 * 30-min chunks at 64kbps ≈ 14.4MB. Returns "~30 min" style string.
 */
export function estimateDuration(sizeBytes: number): string {
  // 64kbps MP3 = 8KB/sec = 480KB/min
  const minutes = Math.round(sizeBytes / (480 * 1024));
  if (minutes < 1) return '<1 min';
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes} min`;
}
