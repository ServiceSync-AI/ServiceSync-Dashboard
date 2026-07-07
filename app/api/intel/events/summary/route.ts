/**
 * GET /api/events/summary?days=7 — aggregated activity stats
 * ==========================================================
 * Loads events for the last N days (default 7, capped at 30) and runs them
 * through the analyzer to produce headline stats + per-system breakdown.
 *
 * Returns: EventsSummary
 */
import { NextResponse } from 'next/server';
import { loadEventsInRange } from '@/lib/events';
import { summarize } from '@/lib/analyze';

export const runtime = 'nodejs';
export const revalidate = 300;

const DAY_MS = 86_400_000;
const MAX_DAYS = 30;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get('days');
  const days = Math.min(Math.max(parseInt(raw ?? '7', 10) || 7, 1), MAX_DAYS);

  // Anchor the window to the most recent event would require a pre-scan; instead
  // we use a generous now-based window. (The data store is small for the pilot.)
  const end = new Date();
  const start = new Date(end.getTime() - days * DAY_MS);

  try {
    const events = await loadEventsInRange(start.toISOString(), end.toISOString());
    return NextResponse.json(summarize(events), {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to summarize', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
