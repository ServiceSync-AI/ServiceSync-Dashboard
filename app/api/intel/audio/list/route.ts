/**
 * GET /api/audio/list — list MP3s in the audio bucket
 * ===================================================
 * Lists every .mp3 under the audio prefix (newest first) and cross-references
 * the transcripts prefix to flag which already have a transcript. Cached for
 * 5 minutes since the bucket only grows hourly.
 *
 * Returns: AudioFile[]
 */
import { NextResponse } from 'next/server';
import { listAll } from '@/lib/s3';
import { config } from '@/lib/config';
import { encodeKey } from '@/lib/ids';
import type { AudioFile } from '@/lib/types';

export const runtime = 'nodejs';
// Always read live S3; the Cache-Control header below handles the 5-min cache.
export const dynamic = 'force-dynamic';

/** Base filename without extension, lowercased — used to match transcripts. */
function audioBase(key: string): string {
  return (key.split('/').pop() ?? key).replace(/\.mp3$/i, '').toLowerCase();
}

/** Extract recording timestamp from filename like 20260620_100808.mp3 */
function recordingTime(name: string): string {
  const m = name.match(/(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})/);
  if (!m) return '1970-01-01T00:00:00Z';
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

export async function GET() {
  try {
    const [audioObjs, transcriptObjs] = await Promise.all([
      listAll(config.audioBucket, config.audioPrefix),
      listAll(config.audioBucket, config.transcriptsPrefix),
    ]);

    // Map each audio base name -> transcript key, if one exists.
    const transcriptByBase = new Map<string, string>();
    for (const t of transcriptObjs) {
      if (!t.Key || !t.Key.toLowerCase().endsWith('.json')) continue;
      const tname = (t.Key.split('/').pop() ?? '').toLowerCase();
      // Match audio files whose base name appears in the transcript filename.
      transcriptByBase.set(tname.replace(/\.json$/i, ''), t.Key);
    }

    const matchTranscript = (audioKey: string): string | undefined => {
      const base = audioBase(audioKey);
      for (const [tbase, tkey] of transcriptByBase) {
        if (tbase.includes(base)) return tkey;
      }
      return undefined;
    };

    const files: AudioFile[] = audioObjs
      .filter((o) => o.Key && /\.mp3$/i.test(o.Key))
      .map((o) => {
        const key = o.Key!;
        const name = key.split('/').pop() ?? key;
        const transcriptKey = matchTranscript(key);
        return {
          key,
          name,
          size: o.Size ?? 0,
          lastModified: recordingTime(name) || (o.LastModified ?? new Date(0)).toISOString(),
          hasTranscript: Boolean(transcriptKey),
          transcriptKey: transcriptKey ? encodeKey(transcriptKey) : undefined,
        };
      })
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified));

    return NextResponse.json(files, {
      headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to list audio', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
