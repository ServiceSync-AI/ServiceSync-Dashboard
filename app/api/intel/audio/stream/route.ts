/**
 * GET /api/audio/stream?key=siltaylor/20260619_140717.mp3
 * =======================================================
 * Lets the browser <audio> element play an S3 object without exposing AWS creds
 * or proxying the bytes through our server. We presign a short-lived GET URL and
 * 302-redirect to it — the browser then streams directly from S3 (with range
 * support intact for seeking).
 */
import { NextResponse } from 'next/server';
import { presignGet } from '@/lib/s3';
import { config } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const key = new URL(request.url).searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'missing key' }, { status: 400 });
  }
  // Guard against path traversal / cross-prefix access.
  if (!key.startsWith(config.audioPrefix) || key.includes('..')) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 });
  }
  try {
    const url = await presignGet(config.audioBucket, key, 3600);
    return NextResponse.redirect(url, 302);
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to presign', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
