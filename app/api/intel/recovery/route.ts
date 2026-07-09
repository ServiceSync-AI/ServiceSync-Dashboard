/**
 * GET /api/intel/recovery — Declined Work Recovery analysis
 * PATCH /api/intel/recovery — Mark a recovery item as recovered/lost
 * ==================================================================
 * GET: Runs (or returns cached) Claude-powered detection of declined/deferred
 * work across the most recent transcripts. `?refresh=1` forces a recompute; an
 * optional `?day=YYYY-MM-DD` scopes the pass to a specific UTC day.
 *
 * PATCH: Updates an outreach record's recovery_status in DynamoDB.
 * Body: { id (ts), advisor_id, status: 'recovered' | 'lost', recovered_amount?: number }
 *
 * Returns: RecoveryResult (GET) | updated record (PATCH)
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getRecovery } from '@/lib/recovery';
import { resolveAdvisorId } from '@/lib/advisors';
import { updateRecoveryStatus } from '@/lib/outreach';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const params = new URL(req.url).searchParams;
    const force = params.get('refresh') === '1';
    const dayParam = params.get('day')?.trim();
    // Only accept a well-formed calendar day; anything else falls back to recent.
    const day = dayParam && /^\d{4}-\d{2}-\d{2}$/.test(dayParam) ? dayParam : undefined;
    const advisorId = resolveAdvisorId(cookies().get('ss_advisor')?.value);
    const result = await getRecovery(advisorId, day, force);
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

interface PatchBody {
  id: string; // ts (sort key)
  advisor_id?: string;
  status: 'recovered' | 'lost';
  recovered_amount?: number;
}

export async function PATCH(req: Request) {
  try {
    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    if (!body.id || typeof body.id !== 'string') {
      return NextResponse.json({ error: 'id (ts) is required' }, { status: 400 });
    }
    if (!['recovered', 'lost'].includes(body.status)) {
      return NextResponse.json(
        { error: 'status must be "recovered" or "lost"' },
        { status: 400 },
      );
    }

    const advisorId = resolveAdvisorId(
      body.advisor_id ?? cookies().get('ss_advisor')?.value,
    );

    const updated = await updateRecoveryStatus({
      advisorId,
      ts: body.id,
      recoveryStatus: body.status,
      recoveredAmount: body.recovered_amount,
    });

    return NextResponse.json({ success: true, record: updated });
  } catch (err) {
    return NextResponse.json(
      { error: 'recovery status update failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
