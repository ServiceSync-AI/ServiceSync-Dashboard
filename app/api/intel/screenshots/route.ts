/**
 * GET /api/intel/screenshots?date=2026-07-20&advisor_id=siltaylor-chevyland&cursor=...&limit=50
 * =============================================================================================
 * Paginated listing of screenshot objects from S3 under
 * screenshots/{advisor_id}/{YYYY}/{MM}/{DD}/ with presigned GET URLs (1 hour expiry).
 *
 * Query params:
 *   - date        (YYYY-MM-DD, defaults to today UTC)
 *   - advisor_id  (defaults to 'siltaylor-chevyland')
 *   - cursor      (optional S3 ContinuationToken for pagination)
 *   - limit       (page size, default 50)
 *
 * Returns: { screenshots: [{ key, timestamp, url, sizeKB }], nextCursor, hasMore }
 * Sorted by timestamp ascending within each page.
 */
import { NextResponse } from 'next/server';
import { getScreenshotPage, type Screenshot, type ScreenshotPage } from '@/lib/screenshots';
import { todayUTC } from '@/lib/format';

export const runtime = 'nodejs';

/* ─── In-memory page cache (60s TTL) ─── */
const cache = new Map<string, { data: ScreenshotPage; expires: number }>();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date') ?? todayUTC();
  const advisorId = url.searchParams.get('advisor_id') ?? 'siltaylor-chevyland';
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') ?? '50', 10) || 50, 1), 200);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
  }

  try {
    const cacheKey = `${date}:${advisorId}:${cursor}:${limit}`;
    const now = Date.now();
    const cached = cache.get(cacheKey);

    let page: ScreenshotPage;

    if (cached && cached.expires > now) {
      page = cached.data;
    } else {
      page = await getScreenshotPage(date, advisorId, cursor, limit);
      cache.set(cacheKey, { data: page, expires: now + 60_000 });
    }

    return NextResponse.json(
      { screenshots: page.screenshots, nextCursor: page.nextCursor, hasMore: page.hasMore },
      { headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=120' } },
    );
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to load screenshots', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
