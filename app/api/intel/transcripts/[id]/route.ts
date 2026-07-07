/**
 * GET /api/transcripts/[id] — fetch + parse one transcript
 * ========================================================
 * The [id] is a base64url-encoded S3 key (see lib/ids). We fetch the raw AWS
 * Transcribe JSON and parse it into timestamped segments for the viewer.
 *
 * Returns: Transcript
 */
import { NextResponse } from 'next/server';
import { getObjectText } from '@/lib/s3';
import { config } from '@/lib/config';
import { decodeKey } from '@/lib/ids';
import { parseTranscript } from '@/lib/transcribe';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  let key: string;
  try {
    key = decodeKey(params.id);
  } catch {
    return NextResponse.json({ error: 'bad id' }, { status: 400 });
  }

  // Only allow reads inside the transcripts prefix.
  if (!key.startsWith(config.transcriptsPrefix) || key.includes('..')) {
    return NextResponse.json({ error: 'invalid key' }, { status: 400 });
  }

  try {
    const raw = await getObjectText(config.audioBucket, key);
    const transcript = parseTranscript(raw, params.id);
    return NextResponse.json(transcript, {
      headers: { 'Cache-Control': 's-maxage=86400' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to load transcript', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
