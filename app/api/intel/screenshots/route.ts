/**
 * GET /api/intel/screenshots?date=2026-06-19 — screenshot URLs for a day
 * =======================================================================
 * Lists screenshot objects from S3 under the screenshots/{advisor_id}/{YYYY}/{MM}/{DD}/
 * prefix and returns presigned URLs. Returns an empty array when no screenshots
 * exist (which is the current state — capture is coming soon).
 *
 * Returns: { timestamp: string; url: string }[]
 */
import { NextResponse } from 'next/server';
import { listAll, presignGet } from '@/lib/s3';
import { config } from '@/lib/config';
import { todayUTC } from '@/lib/format';

export const runtime = 'nodejs';
export const revalidate = 60;

export interface ScreenshotEntry {
  timestamp: string;
  url: string;
  key: string;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? todayUTC();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const [year, month, day] = date.split('-');
    const advisorId = config.advisorId;
    const prefix = `screenshots/${advisorId}/${year}/${month}/${day}/`;

    const objects = await listAll(config.eventsBucket, prefix);

    if (!objects.length) {
      return NextResponse.json([], {
        headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
      });
    }

    // Generate presigned URLs for each screenshot
    const entries: ScreenshotEntry[] = await Promise.all(
      objects
        .filter((o) => o.Key && /\.(png|jpg|jpeg|webp)$/i.test(o.Key))
        .map(async (o) => {
          const key = o.Key!;
          // Extract timestamp from filename (e.g. 2026-06-19T14-30-00.png)
          const filename = key.split('/').pop() ?? '';
          const tsMatch = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '').replace(/-/g, (m, offset) => {
            // Convert filename timestamp format back to ISO
            if (offset === 4 || offset === 7) return '-'; // date separators
            if (offset === 10) return 'T';
            if (offset === 13 || offset === 16) return ':';
            return m;
          });
          const timestamp = o.LastModified?.toISOString() ?? `${date}T00:00:00.000Z`;

          const presignedUrl = await presignGet(config.eventsBucket, key, 3600);
          return { timestamp, url: presignedUrl, key };
        }),
    );

    return NextResponse.json(entries, {
      headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to load screenshots', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
