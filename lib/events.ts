/**
 * Event loading — fetch + parse browser events from S3
 * ====================================================
 * The Chrome extension → Lambda pipeline writes gzipped JSONL under the events
 * prefix. Keys may embed a date (e.g. .../2026/06/19/...) or not, so we narrow
 * the set of objects to download using LastModified (with a one-day buffer on
 * each side) and then filter parsed events precisely by their own timestamp.
 *
 * Downloads run concurrently but bounded, so a wide date range doesn't open
 * hundreds of simultaneous S3 connections.
 */
import { listAll, getGzippedText } from './s3';
import { config } from './config';
import type { BrowserEvent } from './types';

const DAY_MS = 86_400_000;
// Max concurrent object downloads — keeps memory + sockets in check.
const DOWNLOAD_CONCURRENCY = 8;

/** Parse one gzipped-JSONL blob into events, skipping malformed lines. */
function parseJsonl(text: string): BrowserEvent[] {
  const out: BrowserEvent[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed) as BrowserEvent;
      if (obj && obj.timestamp_utc) out.push(obj);
    } catch {
      // Tolerate partial/corrupt lines rather than failing the whole load.
    }
  }
  return out;
}

/** Run async tasks with a bounded concurrency pool. */
async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Load all browser events whose own timestamp falls within [startISO, endISO].
 *
 * Args:
 *   startISO / endISO: inclusive UTC bounds.
 *
 * Returns:
 *   Events sorted ascending by timestamp.
 */
export async function loadEventsInRange(
  startISO: string,
  endISO: string,
): Promise<BrowserEvent[]> {
  const start = new Date(startISO).getTime();
  const end = new Date(endISO).getTime();

  // TODO(multi-advisor): accept an advisorId and scope to that advisor's events
  // prefix (config.eventsPrefix is Chevyland-only today). See lib/advisors.ts /
  // the ss_advisor cookie plumbing done for /intel/recovery.
  const objs = await listAll(config.eventsBucket, config.eventsPrefix);

  // Candidate objects: modified within a one-day buffer of the requested range.
  const candidates = objs.filter((o) => {
    if (!o.Key) return false;
    const lm = (o.LastModified ?? new Date(0)).getTime();
    return lm >= start - DAY_MS && lm <= end + DAY_MS;
  });

  const blobs = await mapPool(candidates, DOWNLOAD_CONCURRENCY, async (o) => {
    try {
      return await getGzippedText(config.eventsBucket, o.Key!);
    } catch {
      return ''; // skip unreadable object rather than fail the batch
    }
  });

  const events = blobs
    .flatMap(parseJsonl)
    .filter((e) => {
      const t = new Date(e.timestamp_utc).getTime();
      return t >= start && t <= end;
    })
    .sort(
      (a, b) =>
        new Date(a.timestamp_utc).getTime() - new Date(b.timestamp_utc).getTime(),
    );

  return events;
}

/** Convenience: all events on a single UTC day (YYYY-MM-DD). */
export async function loadEventsForDay(day: string): Promise<BrowserEvent[]> {
  return loadEventsInRange(`${day}T00:00:00.000Z`, `${day}T23:59:59.999Z`);
}

/** The single most recent event timestamp (for status checks), or null. */
export async function latestEventTimestamp(): Promise<string | null> {
  const objs = await listAll(config.eventsBucket, config.eventsPrefix);
  if (!objs.length) return null;
  // Newest object by LastModified is the cheapest place to find a recent event.
  const newest = objs.reduce((a, b) =>
    (a.LastModified ?? new Date(0)) > (b.LastModified ?? new Date(0)) ? a : b,
  );
  if (!newest.Key) return null;
  try {
    const events = parseJsonl(await getGzippedText(config.eventsBucket, newest.Key));
    if (!events.length) return (newest.LastModified ?? new Date(0)).toISOString();
    return events
      .map((e) => e.timestamp_utc)
      .sort()
      .pop()!;
  } catch {
    return (newest.LastModified ?? new Date(0)).toISOString();
  }
}
