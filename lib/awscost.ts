/**
 * AWS Cost Explorer — owner-side cloud spend (month-to-date)
 * =========================================================
 * A thin read-only wrapper over Cost Explorer's `GetCostAndUsage`, used by the
 * Usage & Cost page to surface the dashboard's own AWS bill for the current
 * calendar month, broken down by service.
 *
 * Cost Explorer is a global service whose endpoint lives in us-east-1, so the
 * client is always pinned there regardless of `config.aws.region`.
 *
 * NOTE: AWS credits are applied *after* UnblendedCost is computed here, so these
 * figures can read ~$0 while promotional credits are covering real usage. This
 * degrades gracefully — any error (most commonly AccessDenied when the identity
 * lacks `ce:GetCostAndUsage`) returns `{ available: false }` so the page can
 * render a muted fallback instead of crashing.
 */
import {
  CostExplorerClient,
  GetCostAndUsageCommand,
} from '@aws-sdk/client-cost-explorer';

// Single client reused across invocations (warm Lambda / dev server).
// Cost Explorer's endpoint is us-east-1 regardless of the app's region.
let client: CostExplorerClient | null = null;

function ce(): CostExplorerClient {
  if (!client) {
    client = new CostExplorerClient({ region: 'us-east-1' });
  }
  return client;
}

export type ServiceSpend = { service: string; usd: number };

export type CloudSpendMTD =
  | {
      available: true;
      totalUsd: number;
      byService: ServiceSpend[];
      /** Human month label, e.g. "July 2026". */
      month: string;
    }
  | {
      available: false;
      error: string;
    };

/** `YYYY-MM-DD` for a Date, in UTC. */
function ymdUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fetch month-to-date cloud spend grouped by AWS service.
 *
 * Window: first-of-month (UTC) → today+1 (UTC, exclusive end) so the current
 * partial day is included. Uses UnblendedCost at MONTHLY granularity.
 *
 * Returns the total, the top ~8 non-zero services (sorted desc), and a month
 * label — or `{ available: false, error }` if the call fails for any reason.
 */
export async function getCloudSpendMTD(): Promise<CloudSpendMTD> {
  try {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));

    const res = await ce().send(
      new GetCostAndUsageCommand({
        TimePeriod: { Start: ymdUTC(start), End: ymdUTC(end) },
        Granularity: 'MONTHLY',
        Metrics: ['UnblendedCost'],
        GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }],
      }),
    );

    const groups = res.ResultsByTime?.[0]?.Groups ?? [];
    const byService: ServiceSpend[] = groups
      .map((g) => ({
        service: g.Keys?.[0] ?? 'Unknown',
        usd: Number(g.Metrics?.UnblendedCost?.Amount ?? '0'),
      }))
      .filter((s) => s.usd > 0)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 8);

    const totalUsd = groups.reduce(
      (sum, g) => sum + Number(g.Metrics?.UnblendedCost?.Amount ?? '0'),
      0,
    );

    const month = start.toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    return { available: true, totalUsd, byService, month };
  } catch (err) {
    return { available: false, error: String((err as Error).message ?? err) };
  }
}
