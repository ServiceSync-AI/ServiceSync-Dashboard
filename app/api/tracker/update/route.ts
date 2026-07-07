/**
 * POST /api/update — advance a repair order to the next stage
 * ====================================
 * Called by the Chrome extension when the advisor clicks the next stage.
 * Updates the status and sends the appropriate SMS (a celebratory "ready"
 * message when the vehicle is ready, otherwise a plain progress update).
 *
 * Auth: requires the `x-api-key` header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedWrite } from '@/lib/tracker/auth';
import { isRepairStatus } from '@/lib/tracker/statuses';
import { buildReadyMessage, buildStatusMessage, sendSms, vehicleLabel } from '@/lib/tracker/twilio';
import {
  getDealershipById,
  isConditionalCheckFailed,
  updateRepairOrderStatus,
} from '@/lib/tracker/dynamo';
import type { RepairOrder } from '@/lib/tracker/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface UpdateBody {
  tracking_code?: string;
  status?: string;
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedWrite(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: UpdateBody;
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
  const status = body.status;

  // Advance the status and get the updated row back. A missing code fails the
  // attribute_exists condition → treat as not found.
  let order: RepairOrder;
  try {
    order = await updateRepairOrderStatus(code, status, new Date().toISOString());
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      return NextResponse.json({ error: 'tracking code not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'failed to update status' }, { status: 500 });
  }

  const dealership = await getDealershipById(order.dealership_id);

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://track.servicesync.ai';
  const url = `${baseUrl}/track/${code}`;
  const vehicle = vehicleLabel(order.vehicle_year, order.vehicle_make, order.vehicle_model);

  // Best-effort SMS: celebratory copy on "ready", plain progress otherwise.
  // We don't text on the terminal "picked_up" transition — the customer has
  // the car; another text would just be noise.
  if (status === 'ready') {
    await sendSms(
      order.customer_phone,
      buildReadyMessage({
        vehicle,
        pointsEarned: dealership?.points_per_visit ?? 50,
        rewardName: dealership?.reward_name ?? 'Free Oil Change',
        url,
      }),
    );
  } else if (status !== 'picked_up') {
    await sendSms(order.customer_phone, buildStatusMessage(vehicle, status, url));
  }

  return NextResponse.json({ ok: true, tracking_code: code, status }, { status: 200 });
}
