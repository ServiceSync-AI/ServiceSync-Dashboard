/**
 * GET /api/intel/scorecard — Advisor Scorecard
 * =============================================
 * Computes a 0-100 daily productivity score from five weighted inputs:
 *   - Active hours (target 6+ = 25pts, scale linearly)
 *   - Low context switches (<8/hr = 25pts, scale inversely)
 *   - Low friction bursts (0 = 25pts, -5 per burst)
 *   - Assistant usage (1+ query = 15pts)
 *   - Extension uptime (10pts if reporting all day)
 *
 * Accepts:
 *   ?date=YYYY-MM-DD        → single day
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD → range (one score per day)
 *
 * Returns: { scores: ScorecardDay[] }
 */
import { NextResponse } from 'next/server';
import { loadEventsForDay, loadEventsInRange } from '@/lib/events';
import { summarize, buildSessions } from '@/lib/analyze';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDoc } from '@/lib/tracker/dynamo';
import type { BrowserEvent, EventsSummary } from '@/lib/types';

export const runtime = 'nodejs';
export const revalidate = 300;

const TABLE_ASSISTANT_USAGE =
  process.env.TABLE_ASSISTANT_USAGE ?? 'servicesync-assistant-usage';

/** Business hours: 8am–6pm = 10 hours. Extension "all day" = >8h of coverage. */
const BUSINESS_HOURS = 10;
const UPTIME_THRESHOLD_HOURS = 8;

export interface ScoreBreakdown {
  activeHours: { value: number; points: number; max: 25 };
  contextSwitches: { value: number; points: number; max: 25 };
  frictionBursts: { value: number; points: number; max: 25 };
  assistantUsage: { value: number; points: number; max: 15 };
  extensionUptime: { value: number; points: number; max: 10 };
}

export interface ScorecardDay {
  date: string;
  score: number;
  breakdown: ScoreBreakdown;
  color: 'green' | 'yellow' | 'red';
}

function scoreColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 80) return 'green';
  if (score >= 60) return 'yellow';
  return 'red';
}

/** Compute active hours from event durations. */
function getActiveHours(events: BrowserEvent[]): number {
  const totalSec = events.reduce((sum, e) => sum + Math.max(0, e.duration_sec || 0), 0);
  return totalSec / 3600;
}

/** Compute extension uptime: span from first to last event in hours. */
function getUptimeHours(events: BrowserEvent[]): number {
  if (events.length < 2) return events.length > 0 ? 0.1 : 0;
  const sorted = [...events].sort(
    (a, b) => new Date(a.timestamp_utc).getTime() - new Date(b.timestamp_utc).getTime(),
  );
  const first = new Date(sorted[0].timestamp_utc).getTime();
  const last = new Date(sorted[sorted.length - 1].timestamp_utc).getTime();
  return (last - first) / 3_600_000;
}

/** Fetch assistant usage (msg_count) for a single date. */
async function getAssistantQueries(date: string): Promise<number> {
  try {
    const res = await getDoc().send(
      new QueryCommand({
        TableName: TABLE_ASSISTANT_USAGE,
        KeyConditionExpression: '#d = :date',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':date': date },
        // Scan by date across all advisors — the table is small at pilot scale.
        // Actually the PK is advisor_id and SK is date, so we scan by filtering.
        IndexName: undefined,
      }),
    );
    // Sum msg_count across all advisors for the day
    let total = 0;
    for (const item of res.Items ?? []) {
      const count = typeof item.msg_count === 'number' ? item.msg_count : 0;
      total += count;
    }
    return total;
  } catch {
    // If table doesn't exist or auth fails, return 0 — non-fatal for scoring.
    return 0;
  }
}

/** Fetch assistant usage via a Scan with date filter (since PK is advisor_id). */
async function getAssistantQueriesForDate(date: string): Promise<number> {
  try {
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const res = await getDoc().send(
      new ScanCommand({
        TableName: TABLE_ASSISTANT_USAGE,
        FilterExpression: '#d = :date',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':date': date },
      }),
    );
    let total = 0;
    for (const item of res.Items ?? []) {
      const count = typeof item.msg_count === 'number' ? item.msg_count : 0;
      total += count;
    }
    return total;
  } catch {
    return 0;
  }
}

function computeScore(
  events: BrowserEvent[],
  assistantQueries: number,
): ScorecardDay {
  const summary = summarize(events);
  const sessions = buildSessions(events);

  // 1. Active hours (25pts, target 6+, linear scale)
  const activeHrs = getActiveHours(events);
  const activeHoursPts = Math.min(25, Math.round((activeHrs / 6) * 25));

  // 2. Context switches (25pts, target <8/hr, scale inversely)
  const switchesPerHr = summary.avgSwitchesPerHour;
  let switchPts: number;
  if (switchesPerHr <= 8) {
    switchPts = 25;
  } else if (switchesPerHr >= 20) {
    switchPts = 0;
  } else {
    // Linear scale from 25 at 8/hr to 0 at 20/hr
    switchPts = Math.round(25 * (1 - (switchesPerHr - 8) / 12));
  }

  // 3. Friction bursts (25pts, 0 bursts = 25, -5 per burst)
  const frictionBursts = sessions.filter((s) => s.rapidSwitch).length;
  const frictionPts = Math.max(0, 25 - frictionBursts * 5);

  // 4. Assistant usage (15pts if 1+ query)
  const assistantPts = assistantQueries >= 1 ? 15 : 0;

  // 5. Extension uptime (10pts if reporting all day)
  const uptimeHrs = getUptimeHours(events);
  const uptimePts = uptimeHrs >= UPTIME_THRESHOLD_HOURS ? 10 : Math.round((uptimeHrs / UPTIME_THRESHOLD_HOURS) * 10);

  const score = Math.min(100, activeHoursPts + switchPts + frictionPts + assistantPts + uptimePts);
  const date = events.length > 0 ? events[0].timestamp_utc.slice(0, 10) : '';

  return {
    date,
    score,
    breakdown: {
      activeHours: { value: +activeHrs.toFixed(2), points: activeHoursPts, max: 25 },
      contextSwitches: { value: switchesPerHr, points: switchPts, max: 25 },
      frictionBursts: { value: frictionBursts, points: frictionPts, max: 25 },
      assistantUsage: { value: assistantQueries, points: assistantPts, max: 15 },
      extensionUptime: { value: +uptimeHrs.toFixed(2), points: uptimePts, max: 10 },
    },
    color: scoreColor(score),
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  try {
    if (date) {
      // Single day
      const events = await loadEventsForDay(date);
      const assistantQueries = await getAssistantQueriesForDate(date);
      const scorecard = computeScore(events, assistantQueries);
      scorecard.date = date; // Ensure date is set even if no events
      return NextResponse.json({ scores: [scorecard] });
    }

    if (start && end) {
      // Range: compute one score per day
      const startDate = new Date(start);
      const endDate = new Date(end);
      const days: string[] = [];
      const cursor = new Date(startDate);
      while (cursor <= endDate) {
        days.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }

      // Load all events for the range at once, then partition by day
      const allEvents = await loadEventsInRange(
        `${start}T00:00:00.000Z`,
        `${end}T23:59:59.999Z`,
      );

      const eventsByDay = new Map<string, BrowserEvent[]>();
      for (const day of days) eventsByDay.set(day, []);
      for (const ev of allEvents) {
        const day = ev.timestamp_utc.slice(0, 10);
        const bucket = eventsByDay.get(day);
        if (bucket) bucket.push(ev);
      }

      const scores: ScorecardDay[] = [];
      for (const day of days) {
        const dayEvents = eventsByDay.get(day) ?? [];
        const assistantQueries = await getAssistantQueriesForDate(day);
        const scorecard = computeScore(dayEvents, assistantQueries);
        scorecard.date = day;
        scores.push(scorecard);
      }

      return NextResponse.json({ scores });
    }

    // Default: today
    const today = new Date().toISOString().slice(0, 10);
    const events = await loadEventsForDay(today);
    const assistantQueries = await getAssistantQueriesForDate(today);
    const scorecard = computeScore(events, assistantQueries);
    scorecard.date = today;
    return NextResponse.json({ scores: [scorecard] });
  } catch (err) {
    return NextResponse.json(
      { error: 'scorecard computation failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
