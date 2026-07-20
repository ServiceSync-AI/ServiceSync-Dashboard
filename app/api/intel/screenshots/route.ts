/**
 * GET /api/intel/screenshots?date=2026-07-20&advisor_id=siltaylor-chevyland
 * ==========================================================================
 * Lists screenshot objects from S3 under screenshots/{advisor_id}/{YYYY}/{MM}/{DD}/
 * and returns presigned GET URLs (1 hour expiry).
 *
 * Returns: { screenshots: [{ key, timestamp, url, sizeKB }] } sorted by timestamp
 */
import { NextResponse } from 'next/server';
import { listAll, presignGet } from '@/lib/s3';
import { config } from '@/lib/config';
import { todayUTC } from '@/lib/format';

export const runtime = 'nodejs';
export const revalidate = 60;

export interface ScreenshotEntry {
  key: string;
  timestamp: string;
  url: string;
  sizeKB: number;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? todayUTC();
  const advisorId = url.searchParams.get('advisor_id') ?? 'siltaylor-chevyland';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const [year, month, day] = date.split('-');
    const prefix = `screenshots/${advisorId}/${year}/${month}/${day}/`;

    const objects = await listAll(config.eventsBucket, prefix);

    if (!objects.length) {
      return NextResponse.json(
        { screenshots: [] },
        { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } },
      );
    }

    // Generate presigned URLs for each screenshot
    const entries: ScreenshotEntry[] = await Promise.all(
      objects
        .filter((o) => o.Key && /\.(png|jpg|jpeg|webp)$/i.test(o.Key))
        .map(async (o) => {
          const key = o.Key!;
          const filename = key.split('/').pop() ?? '';

          // Filename is epoch_ms.jpg — derive timestamp from it
          const epochMatch = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
          const epochMs = parseInt(epochMatch, 10);
          const timestamp = !isNaN(epochMs)
            ? new Date(epochMs).toISOString()
            : o.LastModified?.toISOString() ?? `${date}T00:00:00.000Z`;

          const sizeKB = Math.round((o.Size ?? 0) / 1024);
          const presignedUrl = await presignGet(config.eventsBucket, key, 3600);

          return { key, timestamp, url: presignedUrl, sizeKB };
        }),
    );

    // Sort by timestamp ascending
    entries.sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );

    return NextResponse.json(
      { screenshots: entries },
      { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to load screenshots', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
