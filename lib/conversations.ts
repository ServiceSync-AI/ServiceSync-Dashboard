/**
 * Advisor↔Assistant Conversations (server-only)
 * =============================================
 * Reads the chat history the assistant backend writes for each advisor. One
 * item per exchange (a user message + the assistant's reply):
 *
 *   Table: servicesync-conversations  (name from TABLE_CONVERSATIONS)
 *     PK advisor_id (S) · SK ts (S, ISO-8601)
 *     attrs: message (S), reply (S), model (S),
 *            in_tokens (N), out_tokens (N), ttl (N)
 *
 * The `ttl` attribute is a DynamoDB TTL — conversations auto-delete after
 * 90 days, so this view is a rolling window, never a permanent record.
 *
 * Reads funnel through the shared doc client from lib/tracker/dynamo.ts so the
 * dashboard's IAM role is the only thing that can touch the data.
 */
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { getDoc } from './tracker/dynamo';

const TABLE_CONVERSATIONS =
  process.env.TABLE_CONVERSATIONS ?? 'servicesync-conversations';

/** A single advisor↔assistant exchange, oldest fields normalized for the UI. */
export interface Conversation {
  ts: string;
  message: string;
  reply: string;
  model: string;
  inTokens: number;
  outTokens: number;
}

/** Coerce a DynamoDB numeric attribute (number or numeric string) to a number. */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * List an advisor's most recent exchanges, newest first.
 *
 * A Query on the partition key with descending sort (ScanIndexForward:false)
 * returns the latest `limit` items for that advisor. Throws on read failure so
 * the page/route can render the "unavailable" card.
 */
export async function listConversations(
  advisorId: string,
  limit = 100,
): Promise<Conversation[]> {
  const { Items } = await getDoc().send(
    new QueryCommand({
      TableName: TABLE_CONVERSATIONS,
      KeyConditionExpression: 'advisor_id = :a',
      ExpressionAttributeValues: { ':a': advisorId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }),
  );
  return (Items ?? []).map<Conversation>((it) => ({
    ts: str(it.ts),
    message: str(it.message),
    reply: str(it.reply),
    model: str(it.model),
    inTokens: num(it.in_tokens),
    outTokens: num(it.out_tokens),
  }));
}

/**
 * The distinct advisor ids that have any recorded conversation.
 *
 * A bounded, paginated Scan projecting only `advisor_id`, deduped. This lets the
 * page populate a selector for advisors that have chat history even if they
 * aren't (yet) in the `servicesync-advisors` directory table. Sorted for a
 * stable UI. Throws on read failure so callers can degrade gracefully.
 */
export async function listConversationAdvisors(): Promise<string[]> {
  const ids = new Set<string>();
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const res = await getDoc().send(
      new ScanCommand({
        TableName: TABLE_CONVERSATIONS,
        ProjectionExpression: 'advisor_id',
        ExclusiveStartKey,
      }),
    );
    for (const it of res.Items ?? []) {
      const id = str(it.advisor_id);
      if (id) ids.add(id);
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return [...ids].sort((a, b) => a.localeCompare(b));
}
