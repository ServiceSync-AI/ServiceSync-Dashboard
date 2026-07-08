/**
 * Outreach SMS — SCAFFOLD, DISABLED BY DEFAULT
 * ============================================
 * Live customer SMS is intentionally OFF. `sendOutreachSms` is a NO-OP unless a
 * human explicitly opts in via `OUTREACH_SEND_ENABLED=true` AND real Twilio
 * credentials are present. Twilio is lazy-imported ONLY inside the enabled
 * branch, so the build never hard-depends on it and no send path can execute by
 * default.
 *
 * DO NOT auto-send. This exists purely so the detection→outreach loop can be
 * flipped live LATER, after a human reviews drafts and turns the flag on — never
 * before. The rest of the app only ever drafts + logs (see lib/outreach.ts).
 */

export interface SmsResult {
  sent: boolean;
  /** Why it did (or did not) send — surfaced in the outreach log. */
  reason: string;
  /** Provider message id when actually sent. */
  sid?: string;
}

/**
 * True only when a human has explicitly enabled sending AND full Twilio creds
 * are configured. Any missing piece keeps sending OFF. This is the single gate
 * every send path must pass.
 */
export function smsSendEnabled(): boolean {
  return (
    process.env.OUTREACH_SEND_ENABLED === 'true' &&
    !!process.env.TWILIO_ACCOUNT_SID &&
    !!process.env.TWILIO_AUTH_TOKEN &&
    !!process.env.TWILIO_FROM_NUMBER
  );
}

/**
 * Send a win-back SMS — GATED. Returns `{ sent:false, reason:'sending disabled' }`
 * unless `smsSendEnabled()` is true. When enabled, Twilio is dynamically imported
 * inside this branch so it is never loaded (and never runs) in the default,
 * disabled configuration.
 */
export async function sendOutreachSms(phone: string, text: string): Promise<SmsResult> {
  if (!smsSendEnabled()) {
    return { sent: false, reason: 'sending disabled' };
  }
  if (!phone) {
    return { sent: false, reason: 'no phone number' };
  }
  try {
    // Lazy import: only loaded when a human has explicitly enabled sending.
    const { default: twilio } = await import('twilio');
    const client = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);
    const msg = await client.messages.create({
      to: phone,
      from: process.env.TWILIO_FROM_NUMBER!,
      body: text,
    });
    return { sent: true, reason: 'sent', sid: msg.sid };
  } catch (err) {
    return { sent: false, reason: `send failed: ${(err as Error).message}` };
  }
}
