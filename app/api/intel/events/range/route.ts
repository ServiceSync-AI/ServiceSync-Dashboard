/**
 * GET /api/intel/events/range?start=2026-06-15&end=2026-06-19 — events for a date range
 * ======================================================================================
 * Loads all browser events within the given inclusive date range using the
 * shared loadEventsInRange helper.
 *
 * Returns: BrowserEvent[]
 */
import { NextResponse } from 'next/server';
import { loadEventsInRange } from '@/lib/events';

export const runtime = 'nodejs';
export const revalidate = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  if (!start || !end) {
    return NextResponse.json(
      { error: 'start and end query params required (YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(start) || !datePattern.test(end)) {
    return NextResponse.json(
      { error: 'start and end must be YYYY-MM-DD' },
      { status: 400 },
    );
  }

  if (start > end) {
    return NextResponse.json(
      { error: 'start must be <= end' },
      { status: 400 },
    );
  }

  try {
    const events = await loadEventsInRange(
      `${start}T00:00:00.000Z`,
      `${end}T23:59:59.999Z`,
    );
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
