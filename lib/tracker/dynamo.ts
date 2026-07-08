/**
 * DynamoDB Data Layer (server-only)
 * ====================================
 * Thin repository over three on-demand DynamoDB tables. All reads/writes for
 * the tracker funnel through here so access patterns stay explicit and the
 * Lambda's IAM role is the only thing that can touch the data.
 *
 * Tables (names come from env so SST/Terraform can inject the deployed names;
 * sensible local defaults let `next dev` work against a local profile):
 *
 *   Dealerships    PK dealership_id            GSI by_slug (slug)
 *   RepairOrders   PK tracking_code           GSI by_dealership (dealership_id, created_at)
 *   Rewards        PK dealership_id, SK phone
 *
 * Why per-(dealership, phone) rewards: loyalty is multi-tenant — a customer's
 * points at one store must not spend at another. The composite key scopes the
 * ledger to each dealership.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { Dealership, RepairOrder, Reward } from './types';
import type { RepairStatus } from './statuses';

// Table names — overridable via env (set by the deploy), with local defaults.
const TABLES = {
  dealerships: process.env.TABLE_DEALERSHIPS ?? 'Dealerships',
  repairOrders: process.env.TABLE_REPAIR_ORDERS ?? 'RepairOrders',
  rewards: process.env.TABLE_REWARDS ?? 'Rewards',
} as const;

// Singletons — reused across warm Lambda invocations. The default credential
// provider chain picks up the Lambda execution role in prod and the local
// profile/env in dev. Region falls back to us-east-1 to match the rest of the stack.
let docClient: DynamoDBDocumentClient | null = null;
export function getDoc(): DynamoDBDocumentClient {
  if (docClient) return docClient;
  const base = new DynamoDBClient({ region: process.env.AWS_REGION ?? 'us-east-1' });
  // removeUndefinedValues lets us pass optional fields as undefined without errors.
  docClient = DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  });
  return docClient;
}

/** True when a conditional write failed its precondition (e.g. code collision). */
export function isConditionalCheckFailed(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

// --- Dealerships ------------------------------------------------------------

/** Fetch a dealership by its immutable id. */
export async function getDealershipById(id: string): Promise<Dealership | null> {
  const { Item } = await getDoc().send(
    new GetCommand({ TableName: TABLES.dealerships, Key: { dealership_id: id } }),
  );
  return (Item as Dealership) ?? null;
}

/** Fetch a dealership by its human slug (e.g. "chevyland") via the by_slug GSI. */
export async function getDealershipBySlug(slug: string): Promise<Dealership | null> {
  const { Items } = await getDoc().send(
    new QueryCommand({
      TableName: TABLES.dealerships,
      IndexName: 'by_slug',
      KeyConditionExpression: 'slug = :slug',
      ExpressionAttributeValues: { ':slug': slug },
      Limit: 1,
    }),
  );
  return (Items?.[0] as Dealership) ?? null;
}

// --- Repair orders ----------------------------------------------------------

/**
 * Insert a repair order, failing if the tracking code already exists.
 *
 * Throws a ConditionalCheckFailedException on collision so the caller can
 * regenerate the code and retry (see isConditionalCheckFailed).
 */
export async function createRepairOrder(order: RepairOrder): Promise<void> {
  await getDoc().send(
    new PutCommand({
      TableName: TABLES.repairOrders,
      Item: order,
      ConditionExpression: 'attribute_not_exists(tracking_code)',
    }),
  );
}

/** Fetch a repair order by tracking code. */
export async function getRepairOrder(trackingCode: string): Promise<RepairOrder | null> {
  const { Item } = await getDoc().send(
    new GetCommand({ TableName: TABLES.repairOrders, Key: { tracking_code: trackingCode } }),
  );
  return (Item as RepairOrder) ?? null;
}

/**
 * Advance a repair order's status and return the updated row.
 *
 * Conditioned on the order existing, so a bad tracking code throws
 * ConditionalCheckFailedException rather than silently creating a partial row.
 */
export async function updateRepairOrderStatus(
  trackingCode: string,
  status: RepairStatus,
  nowIso: string,
): Promise<RepairOrder> {
  const { Attributes } = await getDoc().send(
    new UpdateCommand({
      TableName: TABLES.repairOrders,
      Key: { tracking_code: trackingCode },
      UpdateExpression: 'SET #status = :status, updated_at = :now',
      ConditionExpression: 'attribute_exists(tracking_code)',
      // `status` is a DynamoDB reserved word — alias it.
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status, ':now': nowIso },
      ReturnValues: 'ALL_NEW',
    }),
  );
  return Attributes as RepairOrder;
}

/**
 * List a dealership's repair orders, newest first, via the by_dealership GSI.
 *
 * Backs the advisor console's repair board. Returns the full stored items
 * (including PII) — callers are advisor-authenticated, unlike the public
 * tracker. `limit` is clamped by the calling route.
 */
export async function listRepairOrdersByDealership(
  dealershipId: string,
  limit = 100,
): Promise<RepairOrder[]> {
  const { Items } = await getDoc().send(
    new QueryCommand({
      TableName: TABLES.repairOrders,
      IndexName: 'by_dealership',
      KeyConditionExpression: 'dealership_id = :d',
      ExpressionAttributeValues: { ':d': dealershipId },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }),
  );
  return (Items as RepairOrder[]) ?? [];
}

/**
 * Find a customer's repair orders by phone, newest first, via the by_phone GSI.
 *
 * Powers Phase 3 call screen-pop (caller ID → customer + current RO) and the
 * unified per-customer history. Requires the `by_phone` GSI on RepairOrders.
 */
export async function getRepairOrdersByPhone(
  phone: string,
  limit = 25,
): Promise<RepairOrder[]> {
  const { Items } = await getDoc().send(
    new QueryCommand({
      TableName: TABLES.repairOrders,
      IndexName: 'by_phone',
      KeyConditionExpression: 'customer_phone = :p',
      ExpressionAttributeValues: { ':p': phone },
      ScanIndexForward: false, // newest first
      Limit: limit,
    }),
  );
  return (Items as RepairOrder[]) ?? [];
}

// --- Rewards (loyalty ledger) ----------------------------------------------

/**
 * Atomically award one visit's points to a (dealership, phone) ledger entry.
 *
 * Uses DynamoDB's ADD so concurrent check-ins can't lose an increment, and
 * initializes the row on first visit. Returns the new running totals.
 */
export async function awardVisit(
  dealershipId: string,
  phone: string,
  name: string | null,
  pointsPerVisit: number,
  nowIso: string,
): Promise<{ points: number; visit_count: number }> {
  const { Attributes } = await getDoc().send(
    new UpdateCommand({
      TableName: TABLES.rewards,
      Key: { dealership_id: dealershipId, phone },
      UpdateExpression:
        'ADD points :pts, visit_count :one ' +
        'SET #name = :name, updated_at = :now, created_at = if_not_exists(created_at, :now)',
      // `name` is a DynamoDB reserved word — alias it.
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':pts': pointsPerVisit,
        ':one': 1,
        ':name': name ?? null,
        ':now': nowIso,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );
  const reward = Attributes as Reward;
  return { points: reward.points, visit_count: reward.visit_count };
}

/** Fetch a customer's loyalty balance at a given dealership. */
export async function getReward(dealershipId: string, phone: string): Promise<Reward | null> {
  const { Item } = await getDoc().send(
    new GetCommand({
      TableName: TABLES.rewards,
      Key: { dealership_id: dealershipId, phone },
    }),
  );
  return (Item as Reward) ?? null;
}
