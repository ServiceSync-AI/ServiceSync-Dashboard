/**
 * GET /api/events?date=2026-06-19 — raw browser events for a day
 * ==============================================================
 * Downloads + decompresses the gzipped JSONL for the given UTC day and returns
 * the parsed events (ascending). Defaults to today if no date is given.
 *
 * Returns: BrowserEvent[]
 */
import { NextResponse } from 'next/server';
import { loadEventsForDay } from '@/lib/events';
import { todayUTC } from '@/lib/format';

export const runtime = 'nodejs';
export const revalidate = 60;

export async function GET(request: Request) {
  const date = new URL(request.url).searchParams.get('date') ?? todayUTC();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }
  try {
    const events = await loadEventsForDay(date);
    return NextResponse.json(events, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to load events', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
