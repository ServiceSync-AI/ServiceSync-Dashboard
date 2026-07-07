/**
 * GET /api/orders?dealership_id=chevyland — board feed (BFF)
 * ====================================
 * The browser polls this. It runs server-side in the console's Lambda, calls
 * the customer-tracker feed with the shared secret, and returns only the
 * PII-safe `BoardOrder` shape — so TRACKER_API_KEY and full phone numbers never
 * reach the client.
 *
 * Dealership scoping: Phase 1 reads `dealership_id` from the query, defaulting
 * to DEFAULT_DEALERSHIP_ID. A later phase replaces this with the Cognito
 * advisor's bound dealership.
 */
import { NextRequest, NextResponse } from 'next/server';
import { fetchOrders } from '@/lib/console/tracker';
import { toBoardOrder } from '@/lib/console/board';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const dealershipId =
    req.nextUrl.searchParams.get('dealership_id')?.trim() ||
    process.env.DEFAULT_DEALERSHIP_ID ||
    'chevyland';

  try {
    const orders = await fetchOrders(dealershipId);
    return NextResponse.json(
      { dealership_id: dealershipId, orders: orders.map(toBoardOrder) },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return NextResponse.json({ error: 'failed to load board', detail: message }, { status: 502 });
  }
}
