/**
 * GET /api/intel/advisors — registered advisor directory
 * ======================================================
 * Returns the advisors from the `servicesync-advisors` table (or the single
 * configured fallback). Backs the sidebar advisor selector.
 *
 * Returns: Advisor[]
 */
import { NextResponse } from 'next/server';
import { listAdvisors } from '@/lib/advisors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const advisors = await listAdvisors();
    return NextResponse.json(advisors, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'advisor list failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
