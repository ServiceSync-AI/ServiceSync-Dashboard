/**
 * Tracking Code Generation
 * ====================================
 * Short, human-friendly codes for the SMS link (/track/ABC123). Uses an
 * unambiguous uppercase alphabet (no O/0, I/1) so a customer reading the code
 * aloud — or a glance at the URL — can't be misread.
 */
import { randomInt } from 'crypto';

// Excludes easily-confused characters: no 0/O, no 1/I.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// Length of a tracking code. 6 chars over a 31-char alphabet ≈ 887M
// combinations — ample for a per-dealership volume, low collision risk.
const CODE_LENGTH = 6;

/**
 * Generate a random tracking code.
 *
 * Uses crypto.randomInt for uniform, non-predictable selection (codes act as
 * capability tokens, so they should not be guessable by counting).
 *
 * Returns a 6-character uppercase string, e.g. "ABC234".
 */
export function generateTrackingCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}

/** Normalize user/URL-supplied codes to the canonical uppercase form. */
export function normalizeTrackingCode(raw: string): string {
  return raw.trim().toUpperCase();
}
