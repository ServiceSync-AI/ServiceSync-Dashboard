/**
 * GET /api/intel/roi — Cost-per-Insight ROI tracker
 * =================================================
 * Aggregates AWS spend, insight counts (recovery items, audit reports, assistant
 * queries), and value generated (declined work $ found) over a date window to
 * compute the pilot's cost-per-insight and ROI ratio.
 *
 * Query params:
 *   ?days=7        (default: 7)
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD  (overrides days)
 *
 * Returns: ROIResponse
 */
import { NextRequest, NextResponse } from 'next/server';
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getDoc } from '@/lib/tracker/dynamo';
import { s3 } from '@/lib/s3';
import { config } from '@/lib/config';

export const runtime = 'nodejs';
export const revalidate = 3600;

// ─── In-memory cache for Cost Explorer calls (24h TTL) ──────────────────────
let _ceCache: { key: string; value: number; ts: number } | null = null;
const CE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ROIResponse {
  totalSpend: number;
  insights: {
    recoveryItems: number;
    auditReports: number;
    assistantQueries: number;
    total: number;
  };
  costPerInsight: number;
  valueFound: number;
  roiRatio: number;
  period: { start: string; end: string; days: number };
}

// ─── Config ─────────────────────────────────────────────────────────────────

const TABLE_ASSISTANT_USAGE =
  process.env.TABLE_ASSISTANT_USAGE ?? 'servicesync-assistant-usage';
const TABLE_OUTREACH =
  process.env.TABLE_OUTREACH ?? 'servicesync-recovery-outreach';
const AUDIT_PREFIX = 'audits/';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM-DD for a Date in UTC. */
function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse YYYY-MM-DD to a Date at UTC midnight. */
function parseDate(s: string): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
}

/** Coerce DynamoDB numeric attr to number. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

// ─── Data Fetchers ──────────────────────────────────────────────────────────

/**
 * AWS Cost Explorer: total UnblendedCost for the period.
 * Falls back to 0 if Cost Explorer is inaccessible.
 * Uses in-memory cache with 24h TTL to avoid repeated Cost Explorer calls.
 */
async function fetchAwsSpend(start: string, end: string): Promise<number> {
  const cacheKey = `${start}|${end}`;
  if (_ceCache && _ceCache.key === cacheKey && Date.now() - _ceCache.ts < CE_TTL_MS) {
    return _ceCache.value;
  }
  try {
    const ce = new CostExplorerClient({ region: 'us-east-1' });
    const res = await ce.send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: start, End: end },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
      }),
    );
    const total = (res.ResultsByTime ?? []).reduce(
      (sum, r) => sum + Number(r.Total?.UnblendedCost?.Amount ?? '0'),
      0,
    );
    _ceCache = { key: cacheKey, value: total, ts: Date.now() };
    return total;
  } catch {
    return 0;
  }
}

/**
 * DynamoDB assistant-usage: sum request_count (or msg_count) and cost_usd
 * for dates within the period.
 */
async function fetchAssistantUsage(
  start: string,
  end: string,
): Promise<{ queries: number; cost: number }> {
  let queries = 0;
  let cost = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await getDoc().send(
      new ScanCommand({
        TableName: TABLE_ASSISTANT_USAGE,
        FilterExpression: '#d >= :start AND #d < :end',
        ExpressionAttributeNames: { '#d': 'date' },
        ExpressionAttributeValues: { ':start': start, ':end': end },
        ExclusiveStartKey,
      }),
    );
    for (const it of (res.Items ?? []) as Record<string, unknown>[]) {
      // request_count is the newer field; msg_count is the legacy field
      queries += num(it.request_count) || num(it.msg_count);
      cost += num(it.cost_usd);
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return { queries, cost };
}

/**
 * DynamoDB recovery-outreach: count items + sum est_dollars for records
 * whose `ts` falls within the period.
 */
async function fetchRecoveryOutreach(
  start: string,
  end: string,
): Promise<{ count: number; dollars: number }> {
  let count = 0;
  let dollars = 0;
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await getDoc().send(
      new ScanCommand({
        TableName: TABLE_OUTREACH,
        FilterExpression: '#ts >= :start AND #ts < :end',
        ExpressionAttributeNames: { '#ts': 'ts' },
        ExpressionAttributeValues: { ':start': start, ':end': end },
        ExclusiveStartKey,
      }),
    );
    for (const it of (res.Items ?? []) as Record<string, unknown>[]) {
      count++;
      dollars += num(it.est_dollars);
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);
  return { count, dollars };
}

/**
 * S3 audits/ prefix: count PDF objects whose LastModified falls in range.
 */
async function fetchAuditCount(start: string, end: string): Promise<number> {
  const startDate = new Date(start + 'T00:00:00Z');
  const endDate = new Date(end + 'T00:00:00Z');
  let count = 0;
  let token: string | undefined;
  do {
    const res = await s3().send(
      new ListObjectsV2Command({
        Bucket: config.eventsBucket,
        Prefix: AUDIT_PREFIX,
        ContinuationToken: token,
      }),
    );
    for (const obj of res.Contents ?? []) {
      if (!obj.Key || !obj.LastModified) continue;
      if (!/\.pdf$/i.test(obj.Key)) continue;
      if (obj.LastModified >= startDate && obj.LastModified < endDate) {
        count++;
      }
    }
    token = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (token);
  return count;
}

// ─── Handler ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;

    // Determine date window
    let start: string;
    let end: string;
    let days: number;

    const startParam = params.get('start');
    const endParam = params.get('end');

    if (startParam && endParam && parseDate(startParam) && parseDate(endParam)) {
      start = startParam;
      end = endParam;
      days = Math.round(
        (parseDate(endParam)!.getTime() - parseDate(startParam)!.getTime()) / 86_400_000,
      );
    } else {
      days = Math.max(1, Math.min(90, Number(params.get('days')) || 7));
      const now = new Date();
      const endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const startDate = new Date(endDate.getTime() - days * 86_400_000);
      start = ymdUTC(startDate);
      end = ymdUTC(endDate);
    }

    // Parallel data fetches
    const [awsSpend, assistantUsage, recovery, auditCount] = await Promise.all([
      fetchAwsSpend(start, end),
      fetchAssistantUsage(start, end),
      fetchRecoveryOutreach(start, end),
      fetchAuditCount(start, end),
    ]);

    // Compute cost: prefer Cost Explorer spend, fall back to sum of cost_usd
    const totalSpend = awsSpend > 0 ? awsSpend : assistantUsage.cost;

    const insights = {
      recoveryItems: recovery.count,
      auditReports: auditCount,
      assistantQueries: assistantUsage.queries,
      total: recovery.count + auditCount + assistantUsage.queries,
    };

    const costPerInsight = insights.total > 0 ? totalSpend / insights.total : 0;
    const valueFound = recovery.dollars;
    const roiRatio = totalSpend > 0 ? valueFound / totalSpend : 0;

    const body: ROIResponse = {
      totalSpend,
      insights,
      costPerInsight,
      valueFound,
      roiRatio,
      period: { start, end, days },
    };

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'ROI calculation failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
