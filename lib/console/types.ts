/**
 * Shared Types — Advisor Console
 * ====================================
 * `RepairOrder` mirrors the stored item the tracker's GET /api/orders returns.
 * `BoardOrder` is the trimmed, browser-safe shape the console's own API hands to
 * the client: the full customer phone never leaves the server — only a masked
 * last-four for display — so the board UI can't leak PII into the bundle/logs.
 */
import type { RepairStatus } from './statuses';

// The full row returned by customer-tracker GET /api/orders (advisor-only feed).
export interface RepairOrder {
  tracking_code: string;
  dealership_id: string;
  ro_number: string | null;
  customer_name: string | null;
  customer_phone: string;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  advisor_name: string | null;
  status: RepairStatus;
  created_at: string;
  updated_at: string;
}

// Browser-safe card shape served by the console's GET /api/orders BFF route.
export interface BoardOrder {
  tracking_code: string;
  ro_number: string | null;
  customer_name: string | null;
  phone_last4: string | null; // masked — full phone stays server-side
  vehicle: string; // "2021 Chevrolet Silverado" (or "Vehicle" when unknown)
  advisor_name: string | null;
  status: RepairStatus;
  created_at: string;
  updated_at: string;
}
