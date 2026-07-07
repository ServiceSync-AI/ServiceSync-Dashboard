/**
 * Customer-Tracker API Client (server-only)
 * ====================================
 * The advisor console does not own the repair-order data or the SMS side
 * effects — the customer-tracker app does. So the console reads the board and
 * advances stages by calling the tracker's API with the shared `x-api-key`,
 * keeping the customer tracker + outbound SMS on a single canonical code path.
 *
 * This module is server-only: it reads TRACKER_API_KEY (never NEXT_PUBLIC_) and
 * is imported solely by the console's API routes / server components, so the
 * secret never reaches the browser.
 */
import type { RepairOrder } from './types';
import type { RepairStatus } from './statuses';

function baseUrl(): string {
  const url = process.env.TRACKER_API_BASE_URL;
  if (!url) throw new Error('TRACKER_API_BASE_URL is not configured');
  return url.replace(/\/$/, '');
}

function apiKey(): string {
  const key = process.env.TRACKER_API_KEY;
  if (!key) throw new Error('TRACKER_API_KEY is not configured');
  return key;
}

/** List a dealership's repair orders for the board (newest first). */
export async function fetchOrders(
  dealershipId: string,
  limit = 100,
): Promise<RepairOrder[]> {
  const url = `${baseUrl()}/api/tracker/orders?dealership_id=${encodeURIComponent(
    dealershipId,
  )}&limit=${limit}`;
  const res = await fetch(url, {
    headers: { 'x-api-key': apiKey() },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`tracker GET /api/tracker/orders failed: ${res.status}`);
  }
  const data = (await res.json()) as { orders?: RepairOrder[] };
  return data.orders ?? [];
}

/**
 * Advance an order to a new stage via the tracker's canonical write path.
 *
 * This is the same endpoint the Chrome extension calls, so the customer tracker
 * updates and the stage-change SMS fires exactly as it does from the extension.
 */
export async function advanceOrder(
  trackingCode: string,
  status: RepairStatus,
): Promise<void> {
  const res = await fetch(`${baseUrl()}/api/tracker/update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': apiKey() },
    body: JSON.stringify({ tracking_code: trackingCode, status }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`tracker POST /api/tracker/update failed: ${res.status} ${detail}`);
  }
}
