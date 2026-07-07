/**
 * Twilio SMS (server-only)
 * ====================================
 * Composes and sends the three customer SMS messages (check-in, status change,
 * ready-for-pickup). SMS failures never crash the caller — a repair order must
 * still be created/updated even if the text can't be delivered.
 *
 * Privacy: we never log the message body or the recipient number (PII).
 */
import twilio from 'twilio';
import { type RepairStatus, STATUS_SMS_PHRASE } from './statuses';

// Re-exported for convenience so API routes can import message builders and the
// vehicle label from one place. The implementation lives in vehicle.ts (which
// is client-safe and free of the Twilio SDK).
export { vehicleLabel } from './vehicle';

// --- Message builders -------------------------------------------------------

interface CreateSmsParams {
  customerName: string | null;
  vehicle: string;
  dealershipName: string;
  url: string;
}

/** On check-in: friendly greeting + first tracking link. */
export function buildCreateMessage({
  customerName,
  vehicle,
  dealershipName,
  url,
}: CreateSmsParams): string {
  const greeting = customerName ? `Hi ${customerName}!` : 'Hi!';
  return `${greeting} Your ${vehicle} is checked in at ${dealershipName}. Track progress: ${url}`;
}

/** On any non-ready status change. */
export function buildStatusMessage(
  vehicle: string,
  status: RepairStatus,
  url: string,
): string {
  return `Update: Your ${vehicle} is now in ${STATUS_SMS_PHRASE[status]}. ${url}`;
}

interface ReadySmsParams {
  vehicle: string;
  pointsEarned: number;
  rewardName: string;
  url: string;
}

/** On `ready`: celebratory message highlighting points earned this visit. */
export function buildReadyMessage({
  vehicle,
  pointsEarned,
  rewardName,
  url,
}: ReadySmsParams): string {
  return `Your ${vehicle} is ready for pickup! You earned ${pointsEarned} points toward a ${rewardName.toLowerCase()}. 🎉 ${url}`;
}

// --- Sender -----------------------------------------------------------------

let client: ReturnType<typeof twilio> | null = null;

/** Lazily build the Twilio client; null if creds are absent. */
function getClient(): ReturnType<typeof twilio> | null {
  if (client) return client;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return null;
  client = twilio(sid, token);
  return client;
}

/**
 * Send an SMS. Returns true on success, false on any failure or missing config.
 *
 * Never throws — callers treat SMS as best-effort so the core DB write is never
 * blocked by a telephony outage. Errors are logged WITHOUT the recipient or body.
 *
 * @param to    Recipient number in E.164 format (+1...).
 * @param body  Fully composed message text.
 */
export async function sendSms(to: string, body: string): Promise<boolean> {
  const from = process.env.TWILIO_FROM_NUMBER;
  const sms = getClient();

  if (!sms || !from) {
    // Allows local dev / preview without Twilio creds — log the gap, don't crash.
    console.warn('[twilio] SMS skipped: Twilio not configured');
    return false;
  }

  try {
    await sms.messages.create({ to, from, body });
    return true;
  } catch (error) {
    // Log the error class only — never the number or message body (PII).
    const reason = error instanceof Error ? error.message : 'unknown error';
    console.error(`[twilio] SMS send failed: ${reason}`);
    return false;
  }
}
