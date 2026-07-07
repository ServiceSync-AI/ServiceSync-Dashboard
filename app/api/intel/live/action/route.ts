/**
 * POST /api/live/action — run a fixed remote probe on the dealership PC
 * =====================================================================
 * The /live page exposes a few quick actions (check ffmpeg, disk space, latest
 * audio, Chrome running). Each maps to ONE hard-coded remote command — we never
 * accept an arbitrary command string from the client, only an action name from
 * a fixed allow-list.
 *
 * Body: { action: "ffmpeg" | "disk" | "latestAudio" | "chrome" }
 * Returns: { ok, stdout, stderr }
 */
import { NextResponse } from 'next/server';
import { runRemote, REMOTE_COMMANDS } from '@/lib/ssh';

export const runtime = 'nodejs';

// Allow-list mapping client action names → trusted remote commands.
const ACTIONS: Record<string, string> = {
  ffmpeg: REMOTE_COMMANDS.ffmpegRunning,
  disk: REMOTE_COMMANDS.diskSpace,
  latestAudio: REMOTE_COMMANDS.latestAudio,
  chrome: REMOTE_COMMANDS.chromeRunning,
};

export async function POST(request: Request) {
  let action = '';
  try {
    const body = await request.json();
    action = typeof body?.action === 'string' ? body.action : '';
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }

  const command = ACTIONS[action];
  if (!command) {
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  }

  const result = await runRemote(command);
  return NextResponse.json(result);
}
