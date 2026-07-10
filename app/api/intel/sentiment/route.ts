/**
 * GET /api/intel/sentiment — customer sentiment scoring
 * =====================================================
 * Loads a transcript from S3, runs it through Bedrock (Haiku 4.5) sentiment
 * analysis, and returns the structured result. The transcript_id param is the
 * stem filename (without .json extension) as stored in the transcripts prefix.
 *
 * Query params:
 *   transcript_id (required) — the transcript stem, e.g. "call_2025-07-09_14-30"
 *
 * Returns: SentimentResult { overallScore, overallLabel, flaggedSegments, summary }
 */
import { NextResponse } from 'next/server';
import { getObjectText } from '@/lib/s3';
import { analyzeSentiment } from '@/lib/sentiment';
import { config } from '@/lib/config';
import type { TranscriptSegment } from '@/lib/types';

export const runtime = 'nodejs';
export const revalidate = 3600;

export async function GET(req: Request) {
  try {
    const transcriptId = new URL(req.url).searchParams.get('transcript_id');
    if (!transcriptId) {
      return NextResponse.json(
        { error: 'transcript_id query parameter is required' },
        { status: 400 },
      );
    }

    // Load the transcript JSON from S3.
    const key = `${config.transcriptsPrefix}${transcriptId}.json`;
    const raw = await getObjectText(config.audioBucket, key);
    const transcript = JSON.parse(raw) as { segments?: TranscriptSegment[] };

    if (!transcript.segments || transcript.segments.length === 0) {
      return NextResponse.json(
        { error: 'transcript has no segments', transcriptId },
        { status: 422 },
      );
    }

    const result = await analyzeSentiment(transcript.segments);

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (err) {
    const message = (err as Error).message ?? 'unknown error';
    const status = message.includes('NoSuchKey') ? 404 : 500;
    return NextResponse.json(
      { error: 'sentiment analysis failed', detail: message },
      { status },
    );
  }
}
