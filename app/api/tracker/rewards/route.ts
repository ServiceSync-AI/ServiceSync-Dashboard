/**
 * GET /api/rewards?dealership_id=...&phone=+13185551234 — loyalty lookup
 * ====================================
 * Returns a customer's accumulated points and visit count at a given dealership,
 * plus that dealership's reward config. Loyalty is multi-tenant, so both the
 * dealership and the phone are required to identify a balance.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDealershipById, getReward } from '@/lib/tracker/dynamo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const dealershipId = req.nextUrl.searchParams.get('dealership_id')?.trim();
  const phone = req.nextUrl.searchParams.get('phone')?.trim();

  if (!dealershipId) {
    return NextResponse.json({ error: 'dealership_id is required' }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: 'phone is required' }, { status: 400 });
  }

  // Run both lookups together — they're independent.
  const [reward, dealership] = await Promise.all([
    getReward(dealershipId, phone),
    getDealershipById(dealershipId),
  ]);

  // Unknown phone → a zeroed balance rather than a 404, so callers can render
  // "0 points" without special-casing new customers.
  return NextResponse.json(
    {
      dealership_id: dealershipId,
      phone,
      points: reward?.points ?? 0,
      visit_count: reward?.visit_count ?? 0,
      reward_name: dealership?.reward_name ?? 'Free Oil Change',
      reward_threshold: dealership?.reward_threshold ?? 500,
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
