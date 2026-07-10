/**
 * Sentiment Analysis — Pilot Intelligence Dashboard
 * ==================================================
 * Calls Bedrock (Claude Haiku 4.5) to score customer sentiment across an entire
 * service-desk transcript. Returns an overall score, human-readable label,
 * flagged segments that exhibit notable emotion, and a short narrative summary.
 *
 * Server-side only — depends on the Bedrock client from lib/bedrock.ts.
 */
import { invokeClaude, parseJsonBlock } from './bedrock';
import type { TranscriptSegment } from './types';

/* ─── Output types ─────────────────────────────────────────────────────────── */

export type SentimentLabel = 'positive' | 'neutral' | 'concerned' | 'frustrated';

export interface FlaggedSegment {
  index: number;
  text: string;
  sentiment: SentimentLabel;
  reason: string;
}

export interface SentimentResult {
  overallScore: number; // -1 (frustrated) to +1 (positive)
  overallLabel: SentimentLabel;
  flaggedSegments: FlaggedSegment[];
  summary: string;
}

/* ─── Prompt ───────────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a customer-experience analyst for an automotive service department.
You will receive a transcript broken into timestamped segments. Analyze the CUSTOMER's sentiment throughout the conversation.

Return ONLY valid JSON matching this schema (no prose outside the JSON):

{
  "overallScore": <number from -1.0 (extremely frustrated) to 1.0 (very positive)>,
  "overallLabel": "<one of: positive | neutral | concerned | frustrated>",
  "flaggedSegments": [
    {
      "index": <0-based segment index>,
      "text": "<verbatim segment text>",
      "sentiment": "<positive | neutral | concerned | frustrated>",
      "reason": "<brief explanation why this segment is notable>"
    }
  ],
  "summary": "<2-3 sentence narrative of the customer's emotional arc>"
}

Guidelines:
- Only flag segments with NOTABLE sentiment (strongly positive or negative). Skip neutral filler.
- The overallScore should reflect the customer's experience holistically.
- Score mapping: positive ≥ 0.3, neutral -0.3 to 0.3, concerned -0.3 to -0.6, frustrated < -0.6.
- Keep flaggedSegments to at most 8 entries — pick the most impactful.`;

/* ─── Core function ────────────────────────────────────────────────────────── */

/**
 * Analyze customer sentiment across a set of transcript segments.
 *
 * @param segments - Array of {start, end, text} from the transcript JSON.
 * @returns Structured sentiment result with score, label, flags, and summary.
 */
export async function analyzeSentiment(
  segments: TranscriptSegment[],
): Promise<SentimentResult> {
  // Build a numbered transcript so the model can reference segment indices.
  const formatted = segments
    .map((seg, i) => `[${i}] (${fmtTime(seg.start)}–${fmtTime(seg.end)}) ${seg.text}`)
    .join('\n');

  const userMessage = `Analyze customer sentiment in this service-desk transcript:\n\n${formatted}`;

  const raw = await invokeClaude({
    system: SYSTEM_PROMPT,
    user: userMessage,
    model: 'haiku',
    maxTokens: 1500,
  });

  const parsed = parseJsonBlock<SentimentResult>(raw);
  if (!parsed) {
    throw new Error('Bedrock returned unparseable sentiment response');
  }

  // Clamp score to [-1, 1] and validate label.
  parsed.overallScore = Math.max(-1, Math.min(1, parsed.overallScore));
  if (!isValidLabel(parsed.overallLabel)) {
    parsed.overallLabel = scoreToLabel(parsed.overallScore);
  }

  return parsed;
}

/* ─── Helpers ──────────────────────────────────────────────────────────────── */

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const VALID_LABELS: SentimentLabel[] = ['positive', 'neutral', 'concerned', 'frustrated'];

function isValidLabel(v: unknown): v is SentimentLabel {
  return VALID_LABELS.includes(v as SentimentLabel);
}

function scoreToLabel(score: number): SentimentLabel {
  if (score >= 0.3) return 'positive';
  if (score >= -0.3) return 'neutral';
  if (score >= -0.6) return 'concerned';
  return 'frustrated';
}
