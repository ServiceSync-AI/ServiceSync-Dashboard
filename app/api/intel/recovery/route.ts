/**
 * GET /api/intel/recovery — Declined Work Recovery analysis
 * =========================================================
 * Runs (or returns cached) Claude-powered detection of declined/deferred work
 * across the most recent transcripts. `?refresh=1` forces a recompute.
 *
 * Returns: RecoveryResult
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRecovery } from '@/lib/recovery';
import { resolveAdvisorId } from '@/lib/advisors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get('refresh') === '1';
    const advisorId = resolveAdvisorId(cookies().get('ss_advisor')?.value);
    const result = await getRecovery(advisorId, force);
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'recovery analysis failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
