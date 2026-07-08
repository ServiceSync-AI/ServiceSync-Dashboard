/**
 * Conversations (/intel/conversations) — advisor↔assistant chat history
 * =====================================================================
 * A read-only review of the recent chat exchanges between an advisor and the
 * ServiceSync assistant, rendered as a chat log: each exchange shows the
 * advisor's message (user bubble) then the assistant's reply (assistant
 * bubble), with a timestamp and a small `model · in/out tok` caption.
 *
 * Advisor-aware: scopes to the selected advisor (ss_advisor cookie), falling
 * back to the first advisor that has any recorded conversation. Reads the
 * `servicesync-conversations` table via the shared doc client. Auto-deletes
 * after 90 days (DynamoDB TTL), so this is a rolling window, not a permanent
 * record. Degrades to an "unavailable" card on a table-read failure, mirroring
 * the Recovery page.
 */
import { cookies } from 'next/headers';
import {
  listConversations,
  listConversationAdvisors,
  type Conversation,
} from '@/lib/conversations';
import ConversationAdvisorSelector from '@/components/ConversationAdvisorSelector';
import { absoluteTime } from '@/lib/format';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const int = (n: number) => n.toLocaleString('en-US');

export default async function ConversationsPage() {
  let advisorIds: string[] = [];
  let conversations: Conversation[] = [];
  let selected = '';
  let error: string | null = null;

  const cookieAdvisor = cookies().get('ss_advisor')?.value?.trim();

  try {
    advisorIds = await listConversationAdvisors();
    // Prefer the cookie when it names an advisor that has conversations, else
    // the first advisor with any recorded chat history.
    selected =
      cookieAdvisor && advisorIds.includes(cookieAdvisor)
        ? cookieAdvisor
        : advisorIds[0] ?? cookieAdvisor ?? '';
    if (selected) conversations = await listConversations(selected);
  } catch (err) {
    error = String((err as Error).message);
  }

  return (
    <div className="px-6 py-5">
      <header className="mb-4">
        <h1 className="font-display text-xl font-bold tracking-tight">Conversations</h1>
        <p className="text-2xs text-muted">
          Advisor&#8596;assistant chat history
          {selected ? ` · ${selected}` : ''}
          {!error ? ` · ${conversations.length} exchange${conversations.length === 1 ? '' : 's'}` : ''}
        </p>
      </header>

      {/* Privacy note — always shown. */}
      <div className="card mb-4 border-l-2 border-l-violet text-xs leading-relaxed text-fg/90">
        <span className="stat-label text-violet">Privacy</span>
        <p className="mt-1 text-muted">
          Advisor&#8596;assistant conversations are stored and auto-delete after 90 days.
        </p>
      </div>

      {error ? (
        <div className="card border-l-2 border-l-danger">
          <span className="stat-label text-danger">Conversations unavailable</span>
          <p className="mt-2 text-sm text-fg/90">
            The conversation history couldn&apos;t be read. Most likely the dashboard&apos;s AWS
            identity is missing <span className="font-mono text-cyan">dynamodb:Query</span> /{' '}
            <span className="font-mono text-cyan">Scan</span> on the{' '}
            <span className="font-mono text-cyan">servicesync-conversations</span> table.
          </p>
          <p className="mt-2 font-mono text-2xs text-muted">{error}</p>
        </div>
      ) : (
        <>
          {advisorIds.length > 1 && (
            <div className="mb-4">
              <ConversationAdvisorSelector advisors={advisorIds} selected={selected} />
            </div>
          )}

          {conversations.length === 0 ? (
            <div className="card text-xs text-muted">No conversations recorded yet.</div>
          ) : (
            <div className="flex flex-col gap-5">
              {conversations.map((c, i) => (
                <div key={`${c.ts}-${i}`} className="flex flex-col gap-2">
                  {/* Exchange header — timestamp + model/token caption. */}
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span className="font-mono text-2xs text-muted">{absoluteTime(c.ts)}</span>
                    <span className="font-mono text-2xs text-muted/70">
                      {c.model || 'model n/a'} · {int(c.inTokens)}/{int(c.outTokens)} tok
                    </span>
                  </div>

                  {/* User bubble — the advisor's message. */}
                  <div className="flex justify-end">
                    <div className="card max-w-[85%] border-l-2 border-l-cyan bg-surface-2 text-sm leading-relaxed text-fg">
                      <span className="stat-label mb-1 block text-cyan">Advisor</span>
                      <p className="whitespace-pre-wrap">{c.message || '—'}</p>
                    </div>
                  </div>

                  {/* Assistant bubble — the reply. */}
                  <div className="flex justify-start">
                    <div className="card max-w-[85%] border-l-2 border-l-magenta text-sm leading-relaxed text-fg">
                      <span className="stat-label mb-1 block text-magenta">Assistant</span>
                      <p className="whitespace-pre-wrap">{c.reply || '—'}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <p className="mt-5 text-2xs text-muted">
            Newest first · source: servicesync-conversations · auto-deletes after 90 days (TTL).
          </p>
        </>
      )}
    </div>
  );
}
