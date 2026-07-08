/**
 * Bedrock (Claude) helper — Pilot Intelligence Dashboard
 * ======================================================
 * Server-side only. Thin wrapper over Amazon Bedrock's InvokeModel for Claude,
 * used for analysis-grade passes over the pilot data (e.g. Declined Work
 * Recovery). Auth is IAM: the dashboard's AWS identity must hold
 * `bedrock:InvokeModel` on the Claude inference profiles below.
 *
 * Models mirror the account's enabled inference profiles. Chat-grade work uses
 * Haiku elsewhere (the extension); analysis here defaults to Sonnet 5.
 */
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from './config';

let client: BedrockRuntimeClient | null = null;

function bedrock(): BedrockRuntimeClient {
  if (!client) {
    client = new BedrockRuntimeClient({ region: config.aws.region });
  }
  return client;
}

export const MODELS = {
  haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  sonnet: 'us.anthropic.claude-sonnet-5',
  opus: 'us.anthropic.claude-opus-4-8',
} as const;

export type ModelKey = keyof typeof MODELS;

/**
 * Invoke Claude via Bedrock's Messages API and return the concatenated text.
 *
 * Args:
 *   system:    system prompt (persona + output contract).
 *   user:      the user message (the data to analyze).
 *   model:     friendly model key (default 'sonnet').
 *   maxTokens: output cap (default 1500).
 */
export async function invokeClaude(opts: {
  system: string;
  user: string;
  model?: ModelKey;
  maxTokens?: number;
}): Promise<string> {
  const modelId = MODELS[opts.model ?? 'sonnet'];
  const res = await bedrock().send(
    new InvokeModelCommand({
      modelId,
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: opts.maxTokens ?? 1500,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    }),
  );
  const data = JSON.parse(new TextDecoder().decode(res.body));
  const blocks: Array<{ type?: string; text?: string }> = data.content ?? [];
  return blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim();
}

/**
 * Extract the first JSON value from a model reply, tolerating ```json fences
 * and surrounding prose. Returns null if nothing parseable is found.
 */
export function parseJsonBlock<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start < 0) return null;
  const end = Math.max(candidate.lastIndexOf(']'), candidate.lastIndexOf('}'));
  if (end < start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
