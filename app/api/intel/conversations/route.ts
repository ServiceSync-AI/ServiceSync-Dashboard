/**
 * GET /api/intel/conversations — advisor↔assistant chat history
 * =============================================================
 * With `?advisor=<id>`: returns that advisor's most recent exchanges
 * (newest-first) from the `servicesync-conversations` table. Without it:
 * returns the distinct advisor ids that have any recorded conversation, so a
 * selector can be populated.
 *
 * Returns: Conversation[]  |  { advisors: string[] }
 */
import { NextResponse } from 'next/server';
import {
  listConversations,
  listConversationAdvisors,
} from '@/lib/conversations';
import { resolveAdvisorId } from '@/lib/advisors';

export const runtime = 'nodejs';
export const revalidate = 120;

export async function GET(req: Request) {
  try {
    const advisor = new URL(req.url).searchParams.get('advisor');
    if (!advisor) {
      const advisors = await listConversationAdvisors();
      return NextResponse.json(
        { advisors },
        { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } },
      );
    }
    const conversations = await listConversations(resolveAdvisorId(advisor));
    return NextResponse.json(conversations, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'conversations read failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
