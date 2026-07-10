/**
 * POST /api/intel/coaching — Advisor Interaction Coaching
 * =======================================================
 * Accepts a transcript_id and its segments, sends them to Claude Haiku for
 * coaching analysis. Returns structured feedback: what went well, what to
 * improve, a suggested phrase, and the detected interaction type.
 *
 * The prompt uses an encouraging, growth-oriented tone suitable for advisor
 * development conversations with the dealer principal.
 */
import { NextResponse } from 'next/server';
import { invokeClaude, parseJsonBlock } from '@/lib/bedrock';

export const runtime = 'nodejs';

interface CoachingRequest {
  transcript_id: string;
  segments: { start: number; end: number; text: string }[];
}

export interface CoachingResult {
  didWell: string;
  improvement: string;
  suggestedPhrase: string;
  interactionType: string;
}

const COACHING_SYSTEM = `You are an encouraging service advisor coach at an automotive dealership. Your job is to help advisors communicate more effectively with customers.

Analyze the transcript of a customer interaction and provide structured coaching feedback. Be specific, citing moments from the conversation. Keep your tone supportive — advisors respond best to positive reinforcement paired with one concrete growth area.

Return ONLY valid JSON (no markdown fences, no commentary) with this exact shape:
{
  "didWell": "One specific thing the advisor did well in this interaction (1-2 sentences)",
  "improvement": "One concrete area for improvement with brief reasoning (1-2 sentences)",
  "suggestedPhrase": "An exact phrase the advisor could use next time in a similar moment",
  "interactionType": "The type of interaction: greeting | estimate-presentation | objection-handling | upsell | follow-up | closing | general"
}`;

export async function POST(req: Request) {
  let body: CoachingRequest;
  try {
    body = (await req.json()) as CoachingRequest;
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!body.transcript_id || !Array.isArray(body.segments) || body.segments.length === 0) {
    return NextResponse.json(
      { error: 'transcript_id and non-empty segments[] are required' },
      { status: 400 },
    );
  }

  // Build a readable transcript block for the model.
  const transcriptText = body.segments
    .map((s) => s.text)
    .join(' ')
    .slice(0, 8000); // Cap input to stay within Haiku's sweet spot

  try {
    const raw = await invokeClaude({
      system: COACHING_SYSTEM,
      user: `Here is the transcript of a service advisor interaction:\n\n${transcriptText}`,
      model: 'haiku',
      maxTokens: 500,
    });

    const result = parseJsonBlock<CoachingResult>(raw);
    if (!result || !result.didWell || !result.improvement) {
      return NextResponse.json(
        { error: 'model returned unparseable response', raw },
        { status: 502 },
      );
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: 'coaching analysis failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
