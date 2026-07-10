/**
 * GET /api/intel/uptime?date=YYYY-MM-DD — Extension Uptime Analysis
 * ==================================================================
 * Analyzes browser extension event coverage during business hours (8AM–6PM ET)
 * for a given day. Identifies gaps >30min where no events were received.
 *
 * Returns:
 *   { uptimePercent, lastEvent, gaps, businessMinutes, activeMinutes, eventsCount }
 */
import { NextResponse } from 'next/server';
import { loadEventsForDay } from '@/lib/events';
import { todayUTC } from '@/lib/format';

export const runtime = 'nodejs';
export const revalidate = 120;

/** Business hours in UTC offset (ET is UTC-4 in summer, UTC-5 in winter). */
const BIZ_START_HOUR = 12; // 8AM ET = 12:00 UTC (EDT)
const BIZ_END_HOUR = 22; // 6PM ET = 22:00 UTC (EDT)
const BIZ_MINUTES = (BIZ_END_HOUR - BIZ_START_HOUR) * 60; // 600 minutes

interface Gap {
  start: string; // ISO timestamp
  end: string; // ISO timestamp
  durationMin: number;
}

interface UptimeResult {
  uptimePercent: number;
  lastEvent: string | null;
  gaps: Gap[];
  businessMinutes: number;
  activeMinutes: number;
  eventsCount: number;
}

function analyzeUptime(
  timestamps: string[],
  date: string,
): UptimeResult {
  const bizStart = new Date(`${date}T${String(BIZ_START_HOUR).padStart(2, '0')}:00:00.000Z`);
  const bizEnd = new Date(`${date}T${String(BIZ_END_HOUR).padStart(2, '0')}:00:00.000Z`);
  const now = new Date();

  // If business hours haven't started yet, return 100% with no data
  if (now < bizStart) {
    return {
      uptimePercent: 100,
      lastEvent: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
      gaps: [],
      businessMinutes: BIZ_MINUTES,
      activeMinutes: 0,
      eventsCount: timestamps.length,
    };
  }

  // Effective end is min(now, bizEnd) — don't penalize for future time
  const effectiveEnd = now < bizEnd ? now : bizEnd;
  const effectiveMinutes = Math.round(
    (effectiveEnd.getTime() - bizStart.getTime()) / 60_000,
  );

  // Filter events to business hours only
  const bizEvents = timestamps.filter((ts) => {
    const t = new Date(ts).getTime();
    return t >= bizStart.getTime() && t <= bizEnd.getTime();
  });

  if (bizEvents.length === 0) {
    // No events during business hours
    const gapDuration = Math.round(
      (effectiveEnd.getTime() - bizStart.getTime()) / 60_000,
    );
    return {
      uptimePercent: 0,
      lastEvent: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
      gaps:
        gapDuration > 30
          ? [{ start: bizStart.toISOString(), end: effectiveEnd.toISOString(), durationMin: gapDuration }]
          : [],
      businessMinutes: BIZ_MINUTES,
      activeMinutes: 0,
      eventsCount: 0,
    };
  }

  // Find gaps: periods >30 min between consecutive events during business hours
  const gaps: Gap[] = [];
  let coveredMinutes = 0;

  // Check gap from business start to first event
  const firstEventTime = new Date(bizEvents[0]).getTime();
  const gapFromStart = (firstEventTime - bizStart.getTime()) / 60_000;
  if (gapFromStart > 30) {
    gaps.push({
      start: bizStart.toISOString(),
      end: bizEvents[0],
      durationMin: Math.round(gapFromStart),
    });
  } else {
    coveredMinutes += gapFromStart;
  }

  // Check gaps between consecutive events
  for (let i = 1; i < bizEvents.length; i++) {
    const prev = new Date(bizEvents[i - 1]).getTime();
    const curr = new Date(bizEvents[i]).getTime();
    const gapMin = (curr - prev) / 60_000;

    if (gapMin > 30) {
      gaps.push({
        start: bizEvents[i - 1],
        end: bizEvents[i],
        durationMin: Math.round(gapMin),
      });
    } else {
      coveredMinutes += gapMin;
    }
  }

  // Check gap from last event to effective end
  const lastEventTime = new Date(bizEvents[bizEvents.length - 1]).getTime();
  const gapToEnd = (effectiveEnd.getTime() - lastEventTime) / 60_000;
  if (gapToEnd > 30) {
    gaps.push({
      start: bizEvents[bizEvents.length - 1],
      end: effectiveEnd.toISOString(),
      durationMin: Math.round(gapToEnd),
    });
  } else {
    coveredMinutes += gapToEnd;
  }

  const activeMinutes = Math.round(coveredMinutes);
  const uptimePercent =
    effectiveMinutes > 0
      ? Math.round((activeMinutes / effectiveMinutes) * 100)
      : 100;

  return {
    uptimePercent: Math.min(100, uptimePercent),
    lastEvent: bizEvents[bizEvents.length - 1],
    gaps,
    businessMinutes: BIZ_MINUTES,
    activeMinutes,
    eventsCount: bizEvents.length,
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const date = params.get('date') ?? todayUTC();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const events = await loadEventsForDay(date);
    const timestamps = events
      .map((e) => e.timestamp_utc)
      .sort();

    const result = analyzeUptime(timestamps, date);

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'uptime analysis failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
