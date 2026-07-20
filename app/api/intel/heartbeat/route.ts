/**
 * GET /api/intel/heartbeat — Service Health from Watchdog
 * ========================================================
 * Reads the latest heartbeat from DynamoDB (servicesync-heartbeats table)
 * and returns service status with staleness info.
 *
 * Returns: { advisor_id, services, lastSeen, minutesAgo }
 */
import { NextResponse } from 'next/server';
import { DynamoDBClient, ScanCommand } from '@aws-sdk/client-dynamodb';

export const runtime = 'nodejs';
export const revalidate = 60;

const dynamo = new DynamoDBClient({ region: 'us-east-1' });

interface HeartbeatItem {
  advisor_id: string;
  services: Record<string, string>;
  lastSeen: string;
  minutesAgo: number;
}

export async function GET() {
  try {
    const result = await dynamo.send(
      new ScanCommand({ TableName: 'servicesync-heartbeats' }),
    );

    const items: HeartbeatItem[] = (result.Items ?? []).map((item) => {
      const advisorId = item.advisor_id?.S ?? 'unknown';
      const timestamp = item.timestamp?.S ?? item.received_at?.S ?? '';
      const servicesMap = item.services?.M ?? {};

      const services: Record<string, string> = {};
      for (const [key, val] of Object.entries(servicesMap)) {
        services[key] = val.S ?? 'unknown';
      }

      const lastSeen = timestamp;
      const minutesAgo = timestamp
        ? Math.round((Date.now() - new Date(timestamp).getTime()) / 60_000)
        : 9999;

      return { advisor_id: advisorId, services, lastSeen, minutesAgo };
    });

    return NextResponse.json(items, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=120' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to fetch heartbeats', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
