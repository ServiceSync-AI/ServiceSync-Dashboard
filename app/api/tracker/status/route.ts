/**
 * GET /api/status?code=ABC123 — public tracker data
 * ====================================
 * Backs the customer tracker page (polled every 30s). Returns only non-sensitive
 * fields — the customer's phone number never appears in the response.
 *
 * Unauthenticated by design: the tracking code is the capability. We still keep
 * PII server-side so a leaked code reveals progress, not a phone number.
 */
import { NextRequest, NextResponse } from 'next/server';
import { normalizeTrackingCode } from '@/lib/tracker/codes';
import { getDealershipById, getRepairOrder, getReward } from '@/lib/tracker/dynamo';
import type { TrackerView } from '@/lib/tracker/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const rawCode = req.nextUrl.searchParams.get('code');
  if (!rawCode) {
    return NextResponse.json({ error: 'code is required' }, { status: 400 });
  }
  const code = normalizeTrackingCode(rawCode);

  const order = await getRepairOrder(code);
  if (!order) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const dealership = await getDealershipById(order.dealership_id);

  // Loyalty balance for this customer at this dealership (drives the banner).
  const reward = await getReward(order.dealership_id, order.customer_phone);

  const view: TrackerView = {
    tracking_code: order.tracking_code,
    ro_number: order.ro_number,
    status: order.status,
    updated_at: order.updated_at,
    vehicle: {
      year: order.vehicle_year,
      make: order.vehicle_make,
      model: order.vehicle_model,
    },
    advisor_name: order.advisor_name,
    dealership: {
      name: dealership?.name ?? 'Service Center',
      phone: dealership?.phone ?? null,
      logo_url: dealership?.logo_url ?? null,
      google_review_url: dealership?.google_review_url ?? null,
    },
    rewards: {
      points: reward?.points ?? 0,
      threshold: dealership?.reward_threshold ?? 500,
      reward_name: dealership?.reward_name ?? 'Free Oil Change',
    },
  };

  // Never cache — the customer is watching for stage changes in real time.
  return NextResponse.json(view, {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
