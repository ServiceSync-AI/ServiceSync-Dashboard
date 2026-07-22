/**
 * GET /api/intel/screenshots/image?key=screenshots/…
 * ===================================================
 * Presigned-URL image proxy for the Rewind page. Instead of embedding long-lived
 * presigned URLs in the client payload, the frontend points <img> src here and
 * receives a short-lived 302 redirect to S3. This keeps presigned URLs out of
 * the DOM and allows browser-level caching (4 min) without leaking credentials.
 *
 * Query params:
 *   key  — S3 object key (must start with "screenshots/")
 *
 * Security: only keys under the screenshots/ prefix are permitted.
 */
import { NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from '@/lib/s3';
import { config } from '@/lib/config';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key');

  if (!key) {
    return NextResponse.json(
      { error: 'missing required query param: key' },
      { status: 400 },
    );
  }

  if (!key.startsWith('screenshots/')) {
    return NextResponse.json(
      { error: 'key must start with "screenshots/"' },
      { status: 400 },
    );
  }

  try {
    const url = await getSignedUrl(
      s3(),
      new GetObjectCommand({ Bucket: config.eventsBucket, Key: key }),
      { expiresIn: 300 },
    );

    const response = NextResponse.redirect(url, 302);
    response.headers.set('Cache-Control', 'private, max-age=240');
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to generate presigned URL', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
