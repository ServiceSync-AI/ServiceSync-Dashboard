/**
 * Weekly Pilot Report — aggregation logic
 * ========================================
 * Pulls data from S3 (browser events), DynamoDB (assistant usage + recovery
 * outreach) for a given date range and produces a structured report suitable
 * for both the dashboard page and the Lambda email sender.
 *
 * Metrics:
 *   - Total events (browser interactions captured)
 *   - Active hours (distinct hours with events, proxy for advisor activity)
 *   - Declined work $ (sum from recovery outreach records)
 *   - Assistant queries (msg_count from usage table)
 *   - Avg switches/hr (system-switch events / active hours)
 *
 * The same logic is used by the API route (/api/intel/report) and the Lambda
 * (servicesync-weekly-report), so neither can drift from the other.
 */
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDoc } from './tracker/dynamo';
import { loadEventsInRange } from './events';
import { classifySystem } from './analyze';
import type { BrowserEvent } from './types';

const TABLE_ASSISTANT_USAGE =
  process.env.TABLE_ASSISTANT_USAGE ?? 'servicesync-assistant-usage';
const TABLE_OUTREACH =
  process.env.TABLE_OUTREACH ?? 'servicesync-recovery-outreach';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WeeklyMetrics {
  totalEvents: number;
  activeHours: number;
  declinedDollars: number;
  assistantQueries: number;
  avgSwitchesPerHour: number;
}

export interface WeeklyHighlight {
  title: string;
  detail: string;
  metric?: string;
}

export interface WeeklyReportData {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
  current: WeeklyMetrics;
  prior: WeeklyMetrics;
  highlights: WeeklyHighlight[];
  generatedAt: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD for N days ago. */
function daysAgo(n: number, from = new Date()): string {
  return new Date(from.getTime() - n * 86_400_000).toISOString().slice(0, 10);
}

/** Count distinct UTC hours in which at least one event occurred. */
function distinctActiveHours(events: BrowserEvent[]): number {
  const hours = new Set<string>();
  for (const e of events) {
    const ts = e.timestamp_utc;
    if (ts) hours.add(ts.slice(0, 13)); // "YYYY-MM-DDTHH"
  }
  return hours.size;
}

/** Count "system switch" events — when the classified system changes between consecutive events. */
function countSystemSwitches(events: BrowserEvent[]): number {
  if (events.length < 2) return 0;
  let switches = 0;
  let prevSystem = classifySystem(events[0]).label;
  for (let i = 1; i < events.length; i++) {
    const cur = classifySystem(events[i]).label;
    if (cur !== prevSystem) {
      switches++;
      prevSystem = cur;
    }
  }
  return switches;
}

/**
 * Query assistant usage table for a date range.
 * Returns total msg_count across all advisors in [start, end].
 */
async function getAssistantQueries(start: string, end: string): Promise<number> {
  let total = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await getDoc().send(
      new ScanCommand({
        TableName: TABLE_ASSISTANT_USAGE,
        FilterExpression: '#d >= :start AND #d <= :end',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':start': start, ':end': end },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) {
      const count = typeof it.msg_count === 'number' ? it.msg_count : Number(it.msg_count) || 0;
      total += count;
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return total;
}

/**
 * Query the recovery outreach table for declined $ in a date range.
 * The table has PK=advisor_id, SK=ts (ISO). We scan with a filter on ts range.
 */
async function getDeclinedDollars(start: string, end: string): Promise<number> {
  let total = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  const startISO = `${start}T00:00:00.000Z`;
  const endISO = `${end}T23:59:59.999Z`;
  do {
    const res = await getDoc().send(
      new ScanCommand({
        TableName: TABLE_OUTREACH,
        FilterExpression: 'ts >= :start AND ts <= :end',
        ExpressionAttributeValues: { ':start': startISO, ':end': endISO },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) {
      const dollars =
        typeof it.est_dollars === 'number'
          ? it.est_dollars
          : Number(it.est_dollars) || 0;
      total += dollars;
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return total;
}

/** Compute metrics for a date range. */
async function computeMetrics(start: string, end: string): Promise<WeeklyMetrics> {
  const [events, assistantQueries, declinedDollars] = await Promise.all([
    loadEventsInRange(`${start}T00:00:00.000Z`, `${end}T23:59:59.999Z`),
    getAssistantQueries(start, end),
    getDeclinedDollars(start, end),
  ]);

  const activeHours = distinctActiveHours(events);
  const switches = countSystemSwitches(events);
  const avgSwitchesPerHour = activeHours > 0 ? Math.round((switches / activeHours) * 10) / 10 : 0;

  return {
    totalEvents: events.length,
    activeHours,
    declinedDollars: Math.round(declinedDollars),
    assistantQueries,
    avgSwitchesPerHour,
  };
}

/** Generate top highlights by comparing current vs prior week. */
function generateHighlights(
  current: WeeklyMetrics,
  prior: WeeklyMetrics,
): WeeklyHighlight[] {
  const highlights: WeeklyHighlight[] = [];

  // Activity change
  if (prior.totalEvents > 0) {
    const changePct = Math.round(
      ((current.totalEvents - prior.totalEvents) / prior.totalEvents) * 100,
    );
    if (Math.abs(changePct) >= 5) {
      highlights.push({
        title: changePct > 0 ? 'Activity trending up' : 'Activity dipped',
        detail: `${Math.abs(changePct)}% ${changePct > 0 ? 'more' : 'fewer'} events compared to prior week`,
        metric: `${current.totalEvents} vs ${prior.totalEvents}`,
      });
    }
  } else if (current.totalEvents > 0) {
    highlights.push({
      title: 'First week of activity',
      detail: `${current.totalEvents} events captured — baseline established`,
      metric: `${current.totalEvents} events`,
    });
  }

  // Declined work
  if (current.declinedDollars > 0) {
    highlights.push({
      title: 'Declined work detected',
      detail: `$${current.declinedDollars.toLocaleString()} in declined/deferred work identified this week`,
      metric: `$${current.declinedDollars.toLocaleString()}`,
    });
  }

  // Assistant adoption
  if (current.assistantQueries > 0) {
    const priorQ = prior.assistantQueries || 1;
    const growth = Math.round(
      ((current.assistantQueries - priorQ) / priorQ) * 100,
    );
    highlights.push({
      title: 'Assistant engaged',
      detail: `${current.assistantQueries} queries this week${prior.assistantQueries > 0 ? ` (${growth > 0 ? '+' : ''}${growth}% vs prior)` : ''}`,
      metric: `${current.assistantQueries} queries`,
    });
  }

  // Context switching rate
  if (current.avgSwitchesPerHour > 8) {
    highlights.push({
      title: 'High context switching',
      detail: `${current.avgSwitchesPerHour} system switches/hr may indicate workflow friction`,
      metric: `${current.avgSwitchesPerHour}/hr`,
    });
  }

  // Return top 3
  return highlights.slice(0, 3);
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Generate the full weekly report for a date range.
 * Defaults to the last 7 days if no dates provided.
 */
export async function generateWeeklyReport(
  startDate?: string,
  endDate?: string,
): Promise<WeeklyReportData> {
  const end = endDate ?? daysAgo(1); // yesterday
  const start = startDate ?? daysAgo(7, new Date(`${end}T12:00:00Z`));

  // Prior week: same duration, shifted 7 days back
  const daySpan =
    Math.round(
      (new Date(`${end}T23:59:59Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1;
  const priorEnd = daysAgo(1, new Date(`${start}T12:00:00Z`));
  const priorStart = daysAgo(daySpan, new Date(`${priorEnd}T12:00:00Z`));

  const [current, prior] = await Promise.all([
    computeMetrics(start, end),
    computeMetrics(priorStart, priorEnd),
  ]);

  const highlights = generateHighlights(current, prior);

  return {
    start,
    end,
    current,
    prior,
    highlights,
    generatedAt: new Date().toISOString(),
  };
}
