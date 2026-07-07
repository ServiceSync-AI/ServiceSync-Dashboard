/**
 * GET /api/orders?dealership_id=chevyland&limit=100 — advisor repair board feed
 * ====================================
 * Lists a dealership's repair orders (newest first) for the advisor console's
 * live board. Unlike the public GET /api/status, this returns full order rows
 * — including customer name/phone — because it is advisor-only.
 *
 * Auth: requires the `x-api-key` header (same shared secret as the writes). The
 * advisor console calls this server-side from its own Lambda, so the key never
 * reaches a browser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedWrite } from '@/lib/tracker/auth';
import { listRepairOrdersByDealership } from '@/lib/tracker/dynamo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Clamp the page size so a bad query can't trigger an unbounded GSI read.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  if (!isAuthorizedWrite(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const dealershipId = req.nextUrl.searchParams.get('dealership_id')?.trim();
  if (!dealershipId) {
    return NextResponse.json({ error: 'dealership_id is required' }, { status: 400 });
  }

  const rawLimit = Number.parseInt(req.nextUrl.searchParams.get('limit') ?? '', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  let orders;
  try {
    orders = await listRepairOrdersByDealership(dealershipId, limit);
  } catch {
    return NextResponse.json({ error: 'failed to list orders' }, { status: 500 });
  }

  // Never cache — the board is a live view of in-shop work.
  return NextResponse.json(
    { dealership_id: dealershipId, count: orders.length, orders },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
