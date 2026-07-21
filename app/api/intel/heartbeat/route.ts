/**
 * GET /api/intel/heartbeat — Service Health from Watchdog
 * ========================================================
 * Reads the latest heartbeat from DynamoDB (servicesync-heartbeats table)
 * for the siltaylor-chevyland advisor and returns service status with
 * staleness info.
 *
 * Returns: { advisor_id, services: {rewind, ambient, upload, chrome}, lastSeen, minutesAgo }
 */
import { NextResponse } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

export const runtime = 'nodejs';
export const revalidate = 60;

const client = new DynamoDBClient({ region: 'us-east-1' });
const dynamo = DynamoDBDocumentClient.from(client);

const ADVISOR_ID = 'siltaylor-chevyland';

export async function GET() {
  try {
    const result = await dynamo.send(
      new GetCommand({
        TableName: 'servicesync-heartbeats',
        Key: { advisor_id: ADVISOR_ID },
      }),
    );

    if (!result.Item) {
      return NextResponse.json(
        { error: 'No heartbeat found', advisor_id: ADVISOR_ID },
        { status: 404 },
      );
    }

    const item = result.Item;
    const timestamp = (item.timestamp as string) ?? '';
    const servicesRaw = (item.services as Record<string, string>) ?? {};

    const services = {
      rewind: servicesRaw.rewind ?? 'unknown',
      ambient: servicesRaw.ambient ?? 'unknown',
      upload: servicesRaw.upload ?? 'unknown',
      chrome: servicesRaw.chrome ?? 'unknown',
    };

    const minutesAgo = timestamp
      ? Math.round((Date.now() - new Date(timestamp).getTime()) / 60_000)
      : 9999;

    return NextResponse.json(
      { advisor_id: ADVISOR_ID, services, lastSeen: timestamp, minutesAgo },
      { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch heartbeat', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
