/**
 * POST /api/advance — advance one order to its next stage (BFF)
 * ====================================
 * Body: { tracking_code, status } where `status` is the target stage. The
 * client computes the next stage from the card it clicked; we re-validate here
 * and forward to the tracker's canonical POST /api/update (which updates the
 * customer tracker and fires the stage SMS). The secret stays server-side.
 */
import { NextRequest, NextResponse } from 'next/server';
import { advanceOrder } from '@/lib/console/tracker';
import { isRepairStatus } from '@/lib/console/statuses';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AdvanceBody {
  tracking_code?: string;
  status?: string;
}

export async function POST(req: NextRequest) {
  let body: AdvanceBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const code = body.tracking_code?.trim().toUpperCase();
  if (!code) {
    return NextResponse.json({ error: 'tracking_code is required' }, { status: 400 });
  }
  if (!isRepairStatus(body.status)) {
    return NextResponse.json({ error: 'invalid status' }, { status: 400 });
  }

  try {
    await advanceOrder(code, body.status);
    return NextResponse.json({ ok: true, tracking_code: code, status: body.status }, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ error: 'failed to advance order', detail: message }, { status: 502 });
  }
}
