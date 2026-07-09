/**
 * GET /api/intel/compare — Before/After Comparison
 * =================================================
 * Loads events for two date ranges (Period A and Period B), runs summarize()
 * on each, and returns both summaries with computed deltas for the key metrics.
 *
 * Accepts: ?startA=YYYY-MM-DD&endA=YYYY-MM-DD&startB=YYYY-MM-DD&endB=YYYY-MM-DD
 *
 * Returns: { periodA: ComparisonPeriod, periodB: ComparisonPeriod, deltas: Deltas }
 */
import { NextResponse } from 'next/server';
import { loadEventsInRange } from '@/lib/events';
import { summarize, buildSessions } from '@/lib/analyze';
import type { EventsSummary } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ComparisonPeriod {
  start: string;
  end: string;
  summary: EventsSummary;
  frictionBursts: number;
  totalSessions: number;
  daysInRange: number;
}

export interface Delta {
  value: number; // percentage change (positive = increase)
  direction: 'up' | 'down' | 'flat';
  improved: boolean; // context-aware: fewer switches = improvement
}

export interface Deltas {
  activeHours: Delta;
  avgSwitchesPerHour: Delta;
  frictionBursts: Delta;
  totalEvents: Delta;
  idleMinutes: Delta;
}

function computeDelta(
  a: number,
  b: number,
  lowerIsBetter: boolean,
): Delta {
  if (a === 0 && b === 0) return { value: 0, direction: 'flat', improved: false };
  if (a === 0) return { value: 100, direction: 'up', improved: !lowerIsBetter };

  const pct = ((b - a) / a) * 100;
  const direction: 'up' | 'down' | 'flat' =
    Math.abs(pct) < 1 ? 'flat' : pct > 0 ? 'up' : 'down';

  // Determine if the change is an improvement
  let improved: boolean;
  if (direction === 'flat') {
    improved = false;
  } else if (lowerIsBetter) {
    improved = pct < 0; // Going down is good
  } else {
    improved = pct > 0; // Going up is good
  }

  return { value: +pct.toFixed(1), direction, improved };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const startA = url.searchParams.get('startA');
  const endA = url.searchParams.get('endA');
  const startB = url.searchParams.get('startB');
  const endB = url.searchParams.get('endB');

  if (!startA || !endA || !startB || !endB) {
    return NextResponse.json(
      { error: 'Missing required params: startA, endA, startB, endB (YYYY-MM-DD)' },
      { status: 400 },
    );
  }

  try {
    // Load events for both periods in parallel
    const [eventsA, eventsB] = await Promise.all([
      loadEventsInRange(`${startA}T00:00:00.000Z`, `${endA}T23:59:59.999Z`),
      loadEventsInRange(`${startB}T00:00:00.000Z`, `${endB}T23:59:59.999Z`),
    ]);

    const summaryA = summarize(eventsA);
    const summaryB = summarize(eventsB);
    const sessionsA = buildSessions(eventsA);
    const sessionsB = buildSessions(eventsB);

    const frictionA = sessionsA.filter((s) => s.rapidSwitch).length;
    const frictionB = sessionsB.filter((s) => s.rapidSwitch).length;

    const daysA = Math.max(1, Math.ceil(
      (new Date(endA).getTime() - new Date(startA).getTime()) / 86_400_000,
    ) + 1);
    const daysB = Math.max(1, Math.ceil(
      (new Date(endB).getTime() - new Date(startB).getTime()) / 86_400_000,
    ) + 1);

    const periodA: ComparisonPeriod = {
      start: startA,
      end: endA,
      summary: summaryA,
      frictionBursts: frictionA,
      totalSessions: sessionsA.length,
      daysInRange: daysA,
    };

    const periodB: ComparisonPeriod = {
      start: startB,
      end: endB,
      summary: summaryB,
      frictionBursts: frictionB,
      totalSessions: sessionsB.length,
      daysInRange: daysB,
    };

    const deltas: Deltas = {
      activeHours: computeDelta(summaryA.totalHours, summaryB.totalHours, false),
      avgSwitchesPerHour: computeDelta(
        summaryA.avgSwitchesPerHour,
        summaryB.avgSwitchesPerHour,
        true, // lower switches = better
      ),
      frictionBursts: computeDelta(frictionA, frictionB, true), // lower = better
      totalEvents: computeDelta(summaryA.totalEvents, summaryB.totalEvents, false),
      idleMinutes: computeDelta(summaryA.idleMinutes, summaryB.idleMinutes, true),
    };

    return NextResponse.json({ periodA, periodB, deltas });
  } catch (err) {
    return NextResponse.json(
      { error: 'comparison failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
