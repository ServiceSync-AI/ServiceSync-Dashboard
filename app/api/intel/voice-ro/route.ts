/**
 * POST /api/intel/voice-ro — extract structured RO from voice transcript
 * ======================================================================
 * Accepts a transcript string spoken by an advisor, sends it to Claude Haiku
 * (Bedrock) with a prompt to extract structured repair-order fields, and returns
 * the parsed JSON. Used by the Voice RO page to convert speech → structured RO.
 */
import { NextResponse } from 'next/server';
import { invokeClaude, parseJsonBlock } from '@/lib/bedrock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface VoiceROBody {
  transcript?: string;
}

export interface ExtractedRO {
  customer_name: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_vin: string | null;
  services: Array<{ name: string; estimated_cost: number | null }>;
  priority: 'routine' | 'urgent' | 'safety' | 'warranty';
  notes: string | null;
}

const SYSTEM_PROMPT = `You are a repair-order extraction assistant for an automotive dealership service department.

Given a spoken transcript from a service advisor, extract the following fields into a JSON object:

- customer_name: string or null
- vehicle_year: string or null (e.g. "2019")
- vehicle_make: string or null (e.g. "Chevrolet")
- vehicle_model: string or null (e.g. "Equinox")
- vehicle_vin: string or null (only if explicitly stated)
- services: array of { name: string, estimated_cost: number | null }
  - For each service mentioned, provide a reasonable estimated_cost in USD if not stated.
  - Common estimates: oil change ~$80, brake pads ~$350, cabin filter ~$60, tire rotation ~$40, transmission flush ~$200, spark plugs ~$250, battery replacement ~$200, alignment ~$100, coolant flush ~$120, air filter ~$45, wiper blades ~$40.
- priority: one of "routine", "urgent", "safety", "warranty" — infer from context
- notes: any additional context mentioned (appointment preferences, symptoms, etc.) or null

Return ONLY valid JSON. No explanation, no markdown fences.`;

export async function POST(req: Request) {
  try {
    let body: VoiceROBody;
    try {
      body = (await req.json()) as VoiceROBody;
    } catch {
      return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
    }

    const transcript = body.transcript?.trim();
    if (!transcript) {
      return NextResponse.json({ error: 'transcript is required' }, { status: 400 });
    }

    const raw = await invokeClaude({
      system: SYSTEM_PROMPT,
      user: transcript,
      model: 'haiku',
      maxTokens: 800,
    });

    const parsed = parseJsonBlock<ExtractedRO>(raw);
    if (!parsed) {
      return NextResponse.json(
        { error: 'failed to parse model response', raw },
        { status: 502 },
      );
    }

    return NextResponse.json({ ro: parsed }, { status: 200 });
  } catch (err) {
    return NextResponse.json(
      { error: 'voice-ro extraction failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
