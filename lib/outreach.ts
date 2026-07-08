/**
 * Declined-Work Outreach — DRAFT + LOG win-back messages
 * ======================================================
 * Closes the loop on Declined Work Recovery: turn a detected `DeclinedItem` into
 * a short, warm, ready-to-send win-back SMS draft (Claude/Bedrock Haiku, to keep
 * it cheap) and record every draft to DynamoDB so the founder can review exactly
 * what WOULD be sent.
 *
 * IMPORTANT: nothing here sends an SMS. This module only DRAFTS and LOGS.
 * Sending is gated behind lib/sms.ts and is OFF by default. Live customer SMS
 * stays off until a human flips OUTREACH_SEND_ENABLED and wires the send step.
 *
 * Table: servicesync-recovery-outreach
 *   PK advisor_id (S) · SK ts (S, ISO timestamp) — newest-first via reverse query.
 */
import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDoc } from './tracker/dynamo';
import { invokeClaude } from './bedrock';
import type { DeclinedItem } from './recovery';

const TABLE_OUTREACH = process.env.TABLE_OUTREACH ?? 'servicesync-recovery-outreach';

const MAX_SMS_CHARS = 320; // ~2 SMS segments; keep drafts tight

export type OutreachStatus = 'drafted' | 'sent' | 'failed';

/** A stored outreach record — shape mirrors the DynamoDB item. */
export interface OutreachRecord {
  advisor_id: string;
  ts: string;
  status: OutreachStatus;
  declined_item: string;
  vehicle: string | null;
  customer: string | null;
  est_dollars: number | null;
  urgency: string;
  transcript_id: string;
  draft_text: string;
  phone: string | null;
  /** Note on send state (e.g. "sending disabled") — set once a send path exists. */
  send_reason?: string;
}

const DRAFT_SYSTEM = `You are a service advisor at an automotive dealership writing a SHORT win-back text message (SMS) to a customer who recently declined or deferred recommended work.

Write ONE friendly, professional SMS that:
- Is warm and human, never pushy or salesy.
- References the specific declined work naturally (e.g. the brakes, the tires) so it feels personal.
- Gently offers to help them schedule when they're ready, and invites a reply.
- Uses the customer's first name ONLY if it is provided; otherwise open without a name (never write a placeholder like [Name] or [Customer]).
- Mentions a price ONLY if a dollar figure is given; never invent or promise numbers or discounts.
- Is ready to send as-is: no square-bracket placeholders, no "insert X here", no subject line, no signature block.
- Stays under ${MAX_SMS_CHARS} characters.

Return ONLY the message text — no quotes, no preamble, no explanation.`;

/**
 * Draft a win-back SMS for one declined item using Claude Haiku (cheap).
 * Returns clean, send-ready text bounded to MAX_SMS_CHARS. Does NOT send.
 */
export async function draftOutreach(item: DeclinedItem): Promise<string> {
  const facts = [
    `Declined/deferred work: ${item.declinedItem}`,
    item.vehicle ? `Vehicle: ${item.vehicle}` : 'Vehicle: not stated',
    item.customer ? `Customer first name: ${item.customer}` : 'Customer name: not stated',
    item.estDollars != null
      ? `Estimated price: $${Math.round(item.estDollars)}`
      : 'Estimated price: not stated',
    `Urgency: ${item.urgency}`,
    item.quote ? `What they said: "${item.quote}"` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const reply = await invokeClaude({
    system: DRAFT_SYSTEM,
    user: `Write the win-back SMS for this declined job:\n\n${facts}`,
    model: 'haiku',
    maxTokens: 300,
  });

  // Models sometimes wrap the message in quotes — strip a single wrapping pair.
  let text = reply.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (text.length > MAX_SMS_CHARS) {
    text = text.slice(0, MAX_SMS_CHARS - 1).trimEnd() + '…';
  }
  return text;
}

/**
 * Persist an outreach draft to DynamoDB. Defaults to status "drafted" — this is
 * the audit log of what the system proposes to send. It never sends anything.
 */
export async function logOutreach(args: {
  advisorId: string;
  item: DeclinedItem;
  draftText: string;
  phone?: string | null;
  status?: OutreachStatus;
  sendReason?: string;
}): Promise<OutreachRecord> {
  const record: OutreachRecord = {
    advisor_id: args.advisorId,
    ts: new Date().toISOString(),
    status: args.status ?? 'drafted',
    declined_item: args.item.declinedItem,
    vehicle: args.item.vehicle,
    customer: args.item.customer,
    est_dollars: args.item.estDollars,
    urgency: args.item.urgency,
    transcript_id: args.item.transcriptId,
    draft_text: args.draftText,
    phone: args.phone ?? null,
    send_reason: args.sendReason,
  };
  await getDoc().send(new PutCommand({ TableName: TABLE_OUTREACH, Item: record }));
  return record;
}

/** Recent outreach records for an advisor, newest first. */
export async function listOutreach(advisorId: string, limit = 25): Promise<OutreachRecord[]> {
  const { Items } = await getDoc().send(
    new QueryCommand({
      TableName: TABLE_OUTREACH,
      KeyConditionExpression: 'advisor_id = :a',
      ExpressionAttributeValues: { ':a': advisorId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }),
  );
  return (Items as OutreachRecord[]) ?? [];
}
