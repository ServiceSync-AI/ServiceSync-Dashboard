/**
 * POST /api/create — start tracking a repair order
 * ====================================
 * Called by the advisor's Chrome extension when they begin a service visit.
 * Creates the repair order, awards loyalty points for the visit (per spec:
 * points are granted at check-in), sends the initial SMS, and returns the
 * tracking code + public URL.
 *
 * Auth: requires the `x-api-key` header (shared secret with the extension).
 */
import { NextRequest, NextResponse } from 'next/server';
import { isAuthorizedWrite } from '@/lib/tracker/auth';
import { generateTrackingCode } from '@/lib/tracker/codes';
import { buildCreateMessage, sendSms, vehicleLabel } from '@/lib/tracker/twilio';
import {
  awardVisit,
  createRepairOrder,
  getDealershipById,
  getDealershipBySlug,
  isConditionalCheckFailed,
} from '@/lib/tracker/dynamo';
import type { Dealership, RepairOrder } from '@/lib/tracker/types';

export const runtime = 'nodejs'; // Twilio + AWS SDK need the Node runtime, not edge.
export const dynamic = 'force-dynamic';

// How many times to retry on a tracking-code collision before giving up.
const MAX_CODE_ATTEMPTS = 5;

interface CreateBody {
  dealership_id?: string;
  dealership_slug?: string;
  ro_number?: string;
  customer_name?: string;
  customer_phone?: string;
  vehicle_year?: string;
  vehicle_make?: string;
  vehicle_model?: string;
  advisor_name?: string;
}

export async function POST(req: NextRequest) {
  if (!isAuthorizedWrite(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const phone = body.customer_phone?.trim();
  if (!phone) {
    return NextResponse.json({ error: 'customer_phone is required' }, { status: 400 });
  }

  // Resolve the dealership by id (preferred) or slug (defaults to the pilot store).
  let dealership: Dealership | null;
  if (body.dealership_id) {
    dealership = await getDealershipById(body.dealership_id.trim());
  } else {
    dealership = await getDealershipBySlug(body.dealership_slug?.trim() || 'chevyland');
  }
  if (!dealership) {
    return NextResponse.json({ error: 'unknown dealership' }, { status: 404 });
  }

  const nowIso = new Date().toISOString();

  // Award this visit's points atomically (scoped to this dealership + phone).
  try {
    await awardVisit(
      dealership.dealership_id,
      phone,
      body.customer_name ?? null,
      dealership.points_per_visit,
      nowIso,
    );
  } catch {
    return NextResponse.json({ error: 'failed to record loyalty' }, { status: 500 });
  }

  // Insert the repair order, regenerating the code on the rare collision.
  let trackingCode = '';
  let inserted = false;
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt += 1) {
    trackingCode = generateTrackingCode();
    const order: RepairOrder = {
      tracking_code: trackingCode,
      dealership_id: dealership.dealership_id,
      ro_number: body.ro_number ?? null,
      customer_name: body.customer_name ?? null,
      customer_phone: phone,
      vehicle_year: body.vehicle_year ?? null,
      vehicle_make: body.vehicle_make ?? null,
      vehicle_model: body.vehicle_model ?? null,
      advisor_name: body.advisor_name ?? null,
      status: 'checked_in',
      created_at: nowIso,
      updated_at: nowIso,
    };
    try {
      await createRepairOrder(order);
      inserted = true;
      break;
    } catch (error) {
      // Collision on tracking_code → regenerate and retry; anything else is fatal.
      if (!isConditionalCheckFailed(error)) {
        return NextResponse.json({ error: 'failed to create repair order' }, { status: 500 });
      }
    }
  }

  if (!inserted) {
    return NextResponse.json({ error: 'could not allocate tracking code' }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://track.servicesync.ai';
  const url = `${baseUrl}/track/${trackingCode}`;

  // Best-effort SMS — the order already exists regardless of delivery.
  const vehicle = vehicleLabel(
    body.vehicle_year ?? null,
    body.vehicle_make ?? null,
    body.vehicle_model ?? null,
  );
  await sendSms(
    phone,
    buildCreateMessage({
      customerName: body.customer_name ?? null,
      vehicle,
      dealershipName: dealership.name,
      url,
    }),
  );

  return NextResponse.json({ tracking_code: trackingCode, url }, { status: 201 });
}
