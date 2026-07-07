/**
 * Repair Status Definitions
 * ====================================
 * Single source of truth for the repair lifecycle: ordering, customer-facing
 * labels, and the SMS phrasing. Shared by the API routes and the tracker UI so
 * the stage names never drift between the SMS and the page.
 */

// All statuses as stored in Postgres (must match the `repair_status` enum).
export type RepairStatus =
  | 'checked_in'
  | 'inspection'
  | 'repair'
  | 'quality_check'
  | 'ready'
  | 'picked_up';

// The five stages rendered as dots on the tracker. `picked_up` is terminal and
// is treated as "past the last dot" rather than its own dot.
export const TRACKER_STEPS: RepairStatus[] = [
  'checked_in',
  'inspection',
  'repair',
  'quality_check',
  'ready',
];

// Short title shown under each dot and in the "Currently:" line.
export const STATUS_LABELS: Record<RepairStatus, string> = {
  checked_in: 'Checked In',
  inspection: 'Inspection',
  repair: 'In Repair',
  quality_check: 'Quality Check',
  ready: 'Ready',
  picked_up: 'Picked Up',
};

// Lower-case phrase used inside the status-change SMS ("...is now in repair.").
export const STATUS_SMS_PHRASE: Record<RepairStatus, string> = {
  checked_in: 'checked in',
  inspection: 'inspection',
  repair: 'repair',
  quality_check: 'quality check',
  ready: 'ready for pickup',
  picked_up: 'picked up',
};

/**
 * Map a status to its index in the five-dot tracker.
 *
 * Returns the dot index (0-4) for the five visible stages, and 5 for the
 * terminal `picked_up` state so the UI can mark every dot complete.
 */
export function statusToStepIndex(status: RepairStatus): number {
  if (status === 'picked_up') return TRACKER_STEPS.length; // all dots complete
  return TRACKER_STEPS.indexOf(status);
}

/** True once the vehicle is ready or already picked up (drives confetti + review CTA). */
export function isComplete(status: RepairStatus): boolean {
  return status === 'ready' || status === 'picked_up';
}

/** Type guard so API routes can reject bad `status` values from the extension. */
export function isRepairStatus(value: unknown): value is RepairStatus {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)
  );
}
