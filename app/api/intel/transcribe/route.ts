/**
 * /api/transcribe — start a transcription job (POST) or check one (GET)
 * =====================================================================
 * POST { audioKey } → starts AWS Transcribe against the audio object, writing
 *   the result JSON into the transcripts prefix. Returns { jobName, status }.
 * GET ?job=<jobName> → polls the job status.
 */
import { NextResponse } from 'next/server';
import { startTranscription, getJobStatus } from '@/lib/transcribe';
import { config } from '@/lib/config';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let audioKey = '';
  try {
    const body = await request.json();
    audioKey = typeof body?.audioKey === 'string' ? body.audioKey : '';
  } catch {
    return NextResponse.json({ error: 'bad request body' }, { status: 400 });
  }

  if (!audioKey.startsWith(config.audioPrefix) || audioKey.includes('..')) {
    return NextResponse.json({ error: 'invalid audioKey' }, { status: 400 });
  }

  try {
    const result = await startTranscription(audioKey);
    return NextResponse.json(result);
  } catch (err) {
    // A duplicate job name (already transcribing/transcribed) is a common,
    // non-fatal case — surface it clearly.
    const message = String((err as Error).message);
    const conflict = /ConflictException|already exists/i.test(message);
    return NextResponse.json(
      { error: conflict ? 'job already exists for this file' : 'failed to start', detail: message },
      { status: conflict ? 409 : 500 },
    );
  }
}

export async function GET(request: Request) {
  const job = new URL(request.url).searchParams.get('job');
  if (!job) {
    return NextResponse.json({ error: 'missing job' }, { status: 400 });
  }
  try {
    return NextResponse.json(await getJobStatus(job));
  } catch (err) {
    return NextResponse.json(
      { error: 'failed to get job status', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
