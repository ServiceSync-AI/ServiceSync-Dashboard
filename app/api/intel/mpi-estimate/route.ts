/**
 * POST /api/intel/mpi-estimate — MPI Photo → AI Estimate
 * =======================================================
 * Accepts a multipart FormData upload containing a photo of a vehicle part.
 * Converts the image to base64, sends it to Claude Sonnet 4.6 with vision via
 * Bedrock, and returns a structured estimate (part, condition, service,
 * cost range, urgency, customer explanation).
 */
import { NextResponse } from 'next/server';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { NodeHttpHandler } from '@smithy/node-http-handler';
import { config } from '@/lib/config';
import { MODELS, parseJsonBlock } from '@/lib/bedrock';

export const runtime = 'nodejs';

let client: BedrockRuntimeClient | null = null;
function bedrock(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: config.aws.region,
      maxAttempts: 2,
      requestHandler: new NodeHttpHandler({ connectionTimeout: 5000, requestTimeout: 30000 }),
    });
  }
  return client;
}

export interface MPIEstimate {
  part: string;
  condition: string;
  conditionScore: number; // 1-10, 10 = perfect
  serviceNeeded: string;
  costRange: { low: number; high: number };
  urgency: 'immediate' | 'soon' | 'monitor';
  customerExplanation: string;
  confidence: number; // 0-100
}

const SYSTEM_PROMPT = `You are an expert automotive service advisor and ASE-certified technician. 
You are analyzing a photo of a vehicle part taken during a multi-point inspection (MPI).

Analyze the image and return a JSON object with exactly these fields:
{
  "part": "<name of the part shown>",
  "condition": "<brief technical description of current condition>",
  "conditionScore": <1-10 integer, 10 = perfect/new condition>,
  "serviceNeeded": "<specific service or repair recommended>",
  "costRange": { "low": <number>, "high": <number> },
  "urgency": "<one of: immediate | soon | monitor>",
  "customerExplanation": "<2-3 sentence plain-language explanation a customer would understand, describing what they're seeing, why it matters, and what you recommend>",
  "confidence": <0-100 integer representing your confidence in this assessment>
}

Guidelines:
- Cost ranges should reflect typical dealer labor + parts pricing (USD).
- "immediate" = safety concern or will cause further damage if not addressed now.
- "soon" = should be done within next 1-2 service visits.
- "monitor" = not urgent but worth watching at next service.
- Be specific about the part name (e.g., "front brake rotor" not just "brake").
- If you cannot identify the part or the image is unclear, still provide your best assessment with a low confidence score.

Return ONLY the JSON object, no other text.`;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('image') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No image file provided' }, { status: 400 });
    }

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { error: `Unsupported image type: ${file.type}. Use JPEG, PNG, WebP, or GIF.` },
        { status: 400 },
      );
    }

    // Max 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Image must be under 10MB' }, { status: 400 });
    }

    // Convert to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    // Map file.type to Bedrock's expected media_type
    const mediaType = file.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

    // Send to Bedrock with vision
    const res = await bedrock().send(
      new InvokeModelCommand({
        modelId: MODELS.sonnet,
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 1500,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: mediaType,
                    data: base64,
                  },
                },
                {
                  type: 'text',
                  text: 'Analyze this vehicle part photo from an MPI inspection and provide the structured estimate.',
                },
              ],
            },
          ],
        }),
      }),
    );

    const data = JSON.parse(new TextDecoder().decode(res.body));
    const blocks: Array<{ type?: string; text?: string }> = data.content ?? [];
    const rawText = blocks
      .filter((b) => b.type === 'text')
      .map((b) => b.text ?? '')
      .join('')
      .trim();

    const estimate = parseJsonBlock<MPIEstimate>(rawText);
    if (!estimate) {
      return NextResponse.json(
        { error: 'Failed to parse AI response', raw: rawText },
        { status: 502 },
      );
    }

    return NextResponse.json({
      estimate,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = (err as Error).message ?? 'Unknown error';
    console.error('[mpi-estimate]', message);
    return NextResponse.json(
      { error: 'MPI estimate failed', detail: message },
      { status: 500 },
    );
  }
}
