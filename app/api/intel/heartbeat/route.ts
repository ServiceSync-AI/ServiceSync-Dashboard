import { NextResponse } from 'next/server';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';

export const runtime = 'nodejs';
export const revalidate = 60;

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: 'us-east-1' }));

export async function GET() {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: 'servicesync-heartbeats',
      Key: { advisor_id: 'siltaylor-chevyland' },
    }));
    const item = result.Item;
    if (!item) return NextResponse.json({ services: null, minutesAgo: 999 });

    const lastSeen = item.timestamp;
    const minutesAgo = Math.round((Date.now() - new Date(lastSeen).getTime()) / 60000);

    return NextResponse.json({
      advisor_id: item.advisor_id,
      services: item.services,
      lastSeen,
      minutesAgo,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
