/**
 * Vehicle Formatting (client-safe)
 * ====================================
 * Pure helper shared by the UI and the SMS builders. Kept separate from
 * twilio.ts so client components can import it without pulling the server-only
 * Twilio SDK into the browser bundle.
 */

/** Human vehicle label, e.g. "2021 Toyota Camry". Falls back to "vehicle". */
export function vehicleLabel(
  year: string | null,
  make: string | null,
  model: string | null,
): string {
  const label = [year, make, model].filter(Boolean).join(' ').trim();
  return label || 'vehicle';
}
