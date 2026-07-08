/**
 * AWS Transcribe helpers — Pilot Intelligence Dashboard
 * =====================================================
 * Two concerns: (1) kicking off / checking transcription jobs against the audio
 * bucket, and (2) parsing the JSON that AWS Transcribe writes back into the
 * timestamped segment shape the TranscriptViewer expects.
 *
 * Transcribe output has two useful shapes depending on settings:
 *   - results.audio_segments[] — ready-made {start_time,end_time,transcript}
 *   - results.items[]          — per-word items we group into ~sentence windows
 * We prefer audio_segments and fall back to grouping items.
 */
import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  type TranscriptionJobStatus,
} from '@aws-sdk/client-transcribe';
import { config } from './config';
import type { Transcript, TranscriptSegment } from './types';

let client: TranscribeClient | null = null;
function transcribe(): TranscribeClient {
  if (!client) client = new TranscribeClient({ region: config.aws.region });
  return client;
}

/** Seconds between word items beyond which we start a new display segment. */
const SEGMENT_GAP_SEC = 1.5;
/** Max words per grouped segment so lines stay readable. */
const MAX_WORDS_PER_SEGMENT = 20;

/** Derive a deterministic, valid Transcribe job name from an audio key. */
export function jobNameForKey(audioKey: string): string {
  // Job names allow [0-9a-zA-Z._-]; replace everything else.
  const base = audioKey.replace(/[^0-9a-zA-Z._-]/g, '_');
  return `ss_${base}`.slice(0, 200);
}

/**
 * Start a transcription job for an audio object in the audio bucket.
 * Writes the result JSON back into the bucket under the transcripts prefix.
 */
export async function startTranscription(audioKey: string): Promise<{
  jobName: string;
  status: TranscriptionJobStatus | string;
}> {
  const jobName = jobNameForKey(audioKey);
  const mediaUri = `s3://${config.audioBucket}/${audioKey}`;
  const res = await transcribe().send(
    new StartTranscriptionJobCommand({
      TranscriptionJobName: jobName,
      LanguageCode: 'en-US',
      MediaFormat: 'mp3',
      Media: { MediaFileUri: mediaUri },
      OutputBucketName: config.audioBucket,
      OutputKey: `${config.transcriptsPrefix}${jobName}.json`,
    }),
  );
  return {
    jobName,
    status: res.TranscriptionJob?.TranscriptionJobStatus ?? 'IN_PROGRESS',
  };
}

/** Poll a transcription job's status. */
export async function getJobStatus(jobName: string): Promise<{
  status: TranscriptionJobStatus | string;
  reason?: string;
}> {
  const res = await transcribe().send(
    new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
  );
  return {
    status: res.TranscriptionJob?.TranscriptionJobStatus ?? 'UNKNOWN',
    reason: res.TranscriptionJob?.FailureReason,
  };
}

/* ----------------------------- parsing ----------------------------------- */

interface TranscribeItem {
  type: 'pronunciation' | 'punctuation';
  start_time?: string;
  end_time?: string;
  alternatives: { content: string }[];
}

interface TranscribeJson {
  results?: {
    transcripts?: { transcript: string }[];
    audio_segments?: { start_time: string; end_time: string; transcript: string }[];
    items?: TranscribeItem[];
  };
}

/**
 * Flat shape written by the Whisper transcription Lambda (the live pilot
 * source). Unlike AWS Transcribe there are no word/segment timings — just the
 * full text plus some metadata.
 */
interface WhisperJson {
  transcript?: string;
  word_count?: number;
  char_count?: number;
  duration?: number;
  duration_sec?: number;
  filename?: string;
  model?: string;
  created_at?: string;
}

/** Max words per synthetic segment when we have no timings (Whisper). */
const MAX_WORDS_PER_UNTIMED_SEGMENT = 25;

/**
 * Split plain text into readable, untimed segments (start/end = 0). We break on
 * sentence boundaries, further chunking any long sentence into ~25-word windows
 * so lines stay readable in the viewer. All segments carry zero timestamps —
 * the viewer treats those as non-seekable.
 */
export function segmentsFromText(text: string): TranscriptSegment[] {
  const clean = text.trim();
  if (!clean) return [];

  // Split into sentences, keeping trailing punctuation.
  const sentences = clean.match(/[^.!?]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? [clean];

  const segments: TranscriptSegment[] = [];
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean);
    if (words.length <= MAX_WORDS_PER_UNTIMED_SEGMENT) {
      segments.push({ start: 0, end: 0, text: sentence });
    } else {
      for (let i = 0; i < words.length; i += MAX_WORDS_PER_UNTIMED_SEGMENT) {
        segments.push({
          start: 0,
          end: 0,
          text: words.slice(i, i + MAX_WORDS_PER_UNTIMED_SEGMENT).join(' '),
        });
      }
    }
  }
  return segments;
}

/** Group per-word items into readable, timestamped segments. */
function segmentsFromItems(items: TranscribeItem[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  let current: { start: number; end: number; words: string[] } | null = null;

  for (const item of items) {
    if (item.type === 'punctuation') {
      // Attach punctuation to the previous word with no space.
      if (current && current.words.length) {
        current.words[current.words.length - 1] += item.alternatives[0]?.content ?? '';
      }
      continue;
    }
    const start = parseFloat(item.start_time ?? '0');
    const end = parseFloat(item.end_time ?? '0');
    const word = item.alternatives[0]?.content ?? '';

    const shouldBreak =
      current &&
      (start - current.end > SEGMENT_GAP_SEC ||
        current.words.length >= MAX_WORDS_PER_SEGMENT);

    if (!current || shouldBreak) {
      if (current) {
        segments.push({
          start: current.start,
          end: current.end,
          text: current.words.join(' '),
        });
      }
      current = { start, end, words: [word] };
    } else {
      current.words.push(word);
      current.end = end;
    }
  }
  if (current && current.words.length) {
    segments.push({ start: current.start, end: current.end, text: current.words.join(' ') });
  }
  return segments;
}

/**
 * Parse raw AWS Transcribe JSON into the dashboard's Transcript shape.
 *
 * Args:
 *   raw: the JSON string fetched from S3.
 *   id:  url-safe identifier for this transcript (carried through to the UI).
 */
export function parseTranscript(raw: string, id: string): Transcript {
  const data = JSON.parse(raw) as TranscribeJson & WhisperJson;

  // Whisper Lambda flat shape (the live pilot source): a string `transcript`
  // field and no AWS Transcribe `results` block. Detect this FIRST — it has no
  // word timings, so we build readable, untimed segments from the text.
  if (typeof data.transcript === 'string' && !data.results) {
    const text = data.transcript;
    const segments = segmentsFromText(text);
    const wordCount =
      typeof data.word_count === 'number'
        ? data.word_count
        : text.split(/\s+/).filter(Boolean).length;
    const durationSec =
      typeof data.duration_sec === 'number'
        ? data.duration_sec
        : typeof data.duration === 'number'
          ? data.duration
          : 0;
    return { id, text, segments, durationSec, wordCount };
  }

  const fullText = data.results?.transcripts?.[0]?.transcript ?? '';

  let segments: TranscriptSegment[];
  if (data.results?.audio_segments?.length) {
    segments = data.results.audio_segments.map((s) => ({
      start: parseFloat(s.start_time),
      end: parseFloat(s.end_time),
      text: s.transcript,
    }));
  } else if (data.results?.items?.length) {
    segments = segmentsFromItems(data.results.items);
  } else {
    segments = fullText ? [{ start: 0, end: 0, text: fullText }] : [];
  }

  const durationSec = segments.length ? segments[segments.length - 1].end : 0;
  const wordCount = fullText ? fullText.split(/\s+/).filter(Boolean).length : 0;

  return { id, text: fullText, segments, durationSec, wordCount };
}
