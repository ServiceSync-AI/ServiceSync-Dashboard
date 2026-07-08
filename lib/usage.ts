/**
 * Assistant Usage & Cost (server-only)
 * ====================================
 * Reads the per-advisor metering table the assistant backend writes to and
 * aggregates it into a cost report. One row per (advisor, day):
 *
 *   Table: servicesync-assistant-usage
 *     PK advisor_id (S) · SK date (S, "YYYY-MM-DD")
 *     attrs: msg_count (N, always present)
 *            in_tokens, out_tokens, cost_usd (N, ABSENT on older rows /
 *            until the metering backend lands — default to 0)
 *
 * Both row shapes are handled: rows that predate token/cost metering simply
 * contribute their message count. If NO row anywhere carries cost data, the
 * caller shows a messages-only view with a "metering pending" note.
 *
 * Advisor ids that start with `test` or equal `frazier-testing` are the
 * owner/testing traffic — they're bucketed separately so they never inflate
 * the real-advisor totals.
 *
 * A Scan (bounded to the last ~30 days via a filter) is fine here: the table
 * holds one row per advisor per day — tens to low-hundreds of rows at pilot
 * scale, not a hot path. Reuses the shared doc client from tracker/dynamo.
 */
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDoc } from './tracker/dynamo';
import { todayUTC } from './format';

const TABLE_ASSISTANT_USAGE =
  process.env.TABLE_ASSISTANT_USAGE ?? 'servicesync-assistant-usage';

const WINDOW_DAYS = 30;

/** Coerce a DynamoDB numeric attribute (number or numeric string) to a number. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** True for owner/testing traffic that must not mix with real advisors. */
export function isTestingAdvisor(advisorId: string): boolean {
  return advisorId.startsWith('test') || advisorId === 'frazier-testing';
}

/** YYYY-MM-DD `days` days before now (UTC). */
function daysAgoUTC(days: number, now = Date.now()): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

export interface AdvisorUsage {
  advisorId: string;
  messagesToday: number;
  messages30d: number;
  inTokens30d: number;
  outTokens30d: number;
  costToday: number;
  cost30d: number;
}

export interface UsageTotals {
  messagesToday: number;
  messages30d: number;
  inTokens30d: number;
  outTokens30d: number;
  costToday: number;
  cost30d: number;
}

export interface UsageReport {
  /** Real advisors, sorted by 30-day spend then messages, descending. */
  advisors: AdvisorUsage[];
  /** Owner/testing bucket, same shape. */
  testing: AdvisorUsage[];
  /** Totals across REAL advisors only (testing excluded). */
  totals: UsageTotals;
  /** True once any row carries token/cost data. */
  hasCostData: boolean;
  today: string;
  windowDays: number;
  rowCount: number;
  generatedAt: string;
}

const emptyTotals = (): UsageTotals => ({
  messagesToday: 0,
  messages30d: 0,
  inTokens30d: 0,
  outTokens30d: 0,
  costToday: 0,
  cost30d: 0,
});

/**
 * Scan the usage table for the last ~30 days and aggregate per advisor.
 *
 * Throws on read failure (e.g. table missing or the dashboard role lacks
 * dynamodb:Query/GetItem on the table) so the page/route can render the
 * "unavailable" card. `date` is a DynamoDB reserved word, hence the #d alias.
 */
export async function getUsageReport(): Promise<UsageReport> {
  const today = todayUTC();
  const cutoff = daysAgoUTC(WINDOW_DAYS);

  // Page through the scan so we don't silently truncate at 1 MB.
  const items: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await getDoc().send(
      new ScanCommand({
        TableName: TABLE_ASSISTANT_USAGE,
        FilterExpression: '#d >= :cutoff',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':cutoff': cutoff },
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) items.push(it as Record<string, unknown>);
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  const byAdvisor = new Map<string, AdvisorUsage>();
  let hasCostData = false;

  for (const it of items) {
    const advisorId = typeof it.advisor_id === 'string' ? it.advisor_id : '';
    if (!advisorId) continue;
    const date = typeof it.date === 'string' ? it.date : '';

    const msgs = num(it.msg_count);
    const inTok = num(it.in_tokens);
    const outTok = num(it.out_tokens);
    const cost = num(it.cost_usd);
    if ('in_tokens' in it || 'out_tokens' in it || 'cost_usd' in it) hasCostData = true;

    const row =
      byAdvisor.get(advisorId) ??
      {
        advisorId,
        messagesToday: 0,
        messages30d: 0,
        inTokens30d: 0,
        outTokens30d: 0,
        costToday: 0,
        cost30d: 0,
      };

    row.messages30d += msgs;
    row.inTokens30d += inTok;
    row.outTokens30d += outTok;
    row.cost30d += cost;
    if (date === today) {
      row.messagesToday += msgs;
      row.costToday += cost;
    }
    byAdvisor.set(advisorId, row);
  }

  const sortByCostThenMsgs = (a: AdvisorUsage, b: AdvisorUsage) =>
    b.cost30d - a.cost30d || b.messages30d - a.messages30d || a.advisorId.localeCompare(b.advisorId);

  const advisors: AdvisorUsage[] = [];
  const testing: AdvisorUsage[] = [];
  for (const row of byAdvisor.values()) {
    (isTestingAdvisor(row.advisorId) ? testing : advisors).push(row);
  }
  advisors.sort(sortByCostThenMsgs);
  testing.sort(sortByCostThenMsgs);

  const totals = advisors.reduce<UsageTotals>((t, a) => {
    t.messagesToday += a.messagesToday;
    t.messages30d += a.messages30d;
    t.inTokens30d += a.inTokens30d;
    t.outTokens30d += a.outTokens30d;
    t.costToday += a.costToday;
    t.cost30d += a.cost30d;
    return t;
  }, emptyTotals());

  return {
    advisors,
    testing,
    totals,
    hasCostData,
    today,
    windowDays: WINDOW_DAYS,
    rowCount: items.length,
    generatedAt: new Date().toISOString(),
  };
}
