/**
 * GET /api/transcripts/list — list transcript JSON files
 * ======================================================
 * Lists every .json under the transcripts prefix. We don't download bodies here
 * (could be large); word count / duration are surfaced lazily by the [id] route.
 *
 * Returns: TranscriptListEntry[]
 */
import { NextResponse } from 'next/server';
import { listAll } from '@/lib/s3';
import { config } from '@/lib/config';
import { encodeKey } from '@/lib/ids';
import type { TranscriptListEntry } from '@/lib/types';

export const runtime = 'nodejs';
// Always read live S3; the Cache-Control header below handles the 5-min cache.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '30', 10));
  const offset = parseInt(url.searchParams.get('offset') || '0', 10);
  try {
    const objs = await listAll(config.audioBucket, config.transcriptsPrefix);
    const entries: TranscriptListEntry[] = objs
      .filter((o) => o.Key && /\.json$/i.test(o.Key))
      .map((o) => {
        const key = o.Key!;
        const name = key.split('/').pop() ?? key;
        return {
          key,
          id: encodeKey(key),
          // Best-effort: strip our "ss_" job prefix to suggest the source audio.
          audioFile: name.replace(/\.json$/i, '').replace(/^ss_/, ''),
          lastModified: (o.LastModified ?? new Date(0)).toISOString(),
          size: o.Size ?? 0,
        };
      })
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified))
      .slice(offset, offset + limit);

    const total = objs.filter((o) => o.Key && /\.json$/i.test(o.Key)).length;
    return NextResponse.json({ entries, total, limit, offset, hasMore: offset + limit < total }, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to list transcripts', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
