/**
 * Board mapping helpers
 * ====================================
 * Converts the full `RepairOrder` (which carries the customer's phone) into the
 * browser-safe `BoardOrder` the client renders. The full phone is reduced to a
 * masked last-four here, on the server, so it never enters the client bundle —
 * click-to-call (Phase 3/4) will resolve the real number server-side.
 */
import type { RepairOrder, BoardOrder } from './types';

/** "2021 Chevrolet Silverado", collapsing unknown parts; "Vehicle" if all unknown. */
export function vehicleLabel(o: RepairOrder): string {
  const parts = [o.vehicle_year, o.vehicle_make, o.vehicle_model].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Vehicle';
}

/** Last four digits of a phone for display, e.g. "•••• 5309". */
function maskPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return null;
  return `•••• ${digits.slice(-4)}`;
}

/** Project a stored order to the trimmed, PII-safe card the board renders. */
export function toBoardOrder(o: RepairOrder): BoardOrder {
  return {
    tracking_code: o.tracking_code,
    ro_number: o.ro_number,
    customer_name: o.customer_name,
    phone_last4: maskPhone(o.customer_phone),
    vehicle: vehicleLabel(o),
    advisor_name: o.advisor_name,
    status: o.status,
    created_at: o.created_at,
    updated_at: o.updated_at,
  };
}
