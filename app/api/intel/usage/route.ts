/**
 * GET /api/intel/usage — per-advisor assistant Usage & Cost
 * =========================================================
 * Aggregates the last ~30 days of the `servicesync-assistant-usage` table into
 * a per-advisor cost report (messages, in/out tokens, $ today + $ 30d), with a
 * separate owner/testing bucket and real-advisor totals.
 *
 * Returns: UsageReport
 */
import { NextResponse } from 'next/server';
import { getUsageReport } from '@/lib/usage';

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET() {
  try {
    const report = await getUsageReport();
    return NextResponse.json(report, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'usage report failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
