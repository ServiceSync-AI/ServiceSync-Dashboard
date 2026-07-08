/**
 * POST /api/intel/recovery/outreach — draft + log a win-back message
 * ==================================================================
 * Body: { advisorId?, item, phone? } where `item` is a DeclinedItem from the
 * recovery page. Drafts a short win-back SMS (Claude Haiku) and logs it to
 * DynamoDB with status "drafted". Returns the stored record.
 *
 * This route NEVER sends an SMS — sending is gated behind lib/sms.ts and is OFF
 * by default. `smsEnabled` in the response tells the UI whether a human has
 * turned live sending on (it hasn't, by default).
 */
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveAdvisorId } from '@/lib/advisors';
import { draftOutreach, logOutreach } from '@/lib/outreach';
import { smsSendEnabled } from '@/lib/sms';
import type { DeclinedItem, Urgency } from '@/lib/recovery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface OutreachBody {
  advisorId?: string;
  phone?: string;
  item?: Partial<DeclinedItem>;
}

const URGENCIES: Urgency[] = ['safety', 'maintenance', 'cosmetic', 'unknown'];

export async function POST(req: Request) {
  try {
    let body: OutreachBody;
    try {
      body = (await req.json()) as OutreachBody;
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const item = body.item;
    if (!item || typeof item.declinedItem !== 'string' || !item.declinedItem.trim()) {
      return NextResponse.json({ error: 'item.declinedItem is required' }, { status: 400 });
    }

    // Prefer an explicit advisor from the body, else the cookie-scoped advisor.
    const advisorId = resolveAdvisorId(body.advisorId ?? cookies().get('ss_advisor')?.value);

    // Re-validate the client-supplied item into a clean DeclinedItem.
    const normalized: DeclinedItem = {
      vehicle: typeof item.vehicle === 'string' ? item.vehicle : null,
      customer: typeof item.customer === 'string' ? item.customer : null,
      declinedItem: item.declinedItem.trim(),
      estDollars:
        typeof item.estDollars === 'number' && isFinite(item.estDollars) ? item.estDollars : null,
      urgency: URGENCIES.includes(item.urgency as Urgency) ? (item.urgency as Urgency) : 'unknown',
      followUpLogged: item.followUpLogged === true,
      quote: typeof item.quote === 'string' ? item.quote : '',
      transcriptId: typeof item.transcriptId === 'string' ? item.transcriptId : '',
    };

    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;

    const draftText = await draftOutreach(normalized);
    // Log as "drafted" only — this route does not send. Record why sending is off.
    const record = await logOutreach({
      advisorId,
      item: normalized,
      draftText,
      phone,
      status: 'drafted',
      sendReason: smsSendEnabled() ? 'send enabled (not auto-sent)' : 'sending disabled',
    });

    return NextResponse.json({ record, smsEnabled: smsSendEnabled() }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: 'outreach draft failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
