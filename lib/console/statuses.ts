/**
 * Repair Status Definitions (advisor console)
 * ====================================
 * Mirror of customer-tracker/src/lib/statuses.ts so the console's board and the
 * customer tracker never drift on stage names or ordering. The canonical write
 * path still lives in the tracker (POST /api/update); this copy is read-only
 * UI/ordering logic plus the `nextStatus` helper the board uses to advance.
 *
 * Keep in sync with the tracker. If the lifecycle changes, change it there
 * first, then update this file.
 */

export type RepairStatus =
  | 'checked_in'
  | 'inspection'
  | 'repair'
  | 'quality_check'
  | 'ready'
  | 'picked_up';

// Full lifecycle order, including the terminal `picked_up` state. Used to find
// the next stage when an advisor advances a card.
export const STATUS_ORDER: RepairStatus[] = [
  'checked_in',
  'inspection',
  'repair',
  'quality_check',
  'ready',
  'picked_up',
];

// The board's swimlanes. `picked_up` is rendered as a collapsed "done" lane
// rather than an active column.
export const BOARD_COLUMNS: RepairStatus[] = [
  'checked_in',
  'inspection',
  'repair',
  'quality_check',
  'ready',
];

export const STATUS_LABELS: Record<RepairStatus, string> = {
  checked_in: 'Checked In',
  inspection: 'Inspection',
  repair: 'In Repair',
  quality_check: 'Quality Check',
  ready: 'Ready',
  picked_up: 'Picked Up',
};

// Accent color per stage — drives the column header + card stripe.
export const STATUS_ACCENT: Record<RepairStatus, string> = {
  checked_in: '#8b949e', // muted — just arrived
  inspection: '#8B5CF6', // violet
  repair: '#06B6D4', // cyan
  quality_check: '#D946EF', // magenta
  ready: '#22c55e', // green — good to go
  picked_up: '#8b949e', // muted — done
};

/**
 * The stage an order advances to next, or null if it's terminal.
 *
 * `ready` advances to `picked_up` (the advisor marking the car collected);
 * `picked_up` has no next stage.
 */
export function nextStatus(status: RepairStatus): RepairStatus | null {
  const i = STATUS_ORDER.indexOf(status);
  if (i < 0 || i >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[i + 1];
}

/** Label for the advance button, e.g. "→ In Repair" or "Mark Picked Up". */
export function advanceLabel(status: RepairStatus): string | null {
  const next = nextStatus(status);
  if (!next) return null;
  if (next === 'picked_up') return 'Mark Picked Up';
  return `→ ${STATUS_LABELS[next]}`;
}

/** Type guard so server routes can reject bad `status` values from the client. */
export function isRepairStatus(value: unknown): value is RepairStatus {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(STATUS_LABELS, value)
  );
}
