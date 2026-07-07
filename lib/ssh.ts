/**
 * SSH helpers — Live Status remote actions
 * ========================================
 * The /live page can poke the dealership PC over Tailscale to check on the
 * capture pipeline (is ffmpeg running, disk space, latest audio file, pull
 * Chrome history). We shell out to the system `ssh` client with the deploy key
 * rather than pulling in an SSH library — it matches how the rest of this repo
 * already reaches the PC, and keeps the key handling in the OS keyring/agent.
 *
 * SECURITY: commands here are fixed, hard-coded strings — never interpolate
 * user input into a remote command. The reachability check uses a TCP ping
 * with a short timeout so the UI never hangs on an offline PC.
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { config } from './config';

const execAsync = promisify(exec);

/** Expand a leading ~ to the user's home directory for the key path. */
function resolveKeyPath(p: string): string {
  return p.startsWith('~') ? p.replace(/^~/, os.homedir()) : p;
}

/** Common ssh flags: batch mode (no prompts), the deploy key, short timeout. */
function sshBase(): string {
  const key = resolveKeyPath(config.pc.keyPath);
  return [
    'ssh',
    '-i',
    `"${key}"`,
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=6',
    `"${config.pc.user}@${config.pc.ip}"`,
  ].join(' ');
}

export interface RemoteResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run one of our fixed remote commands over SSH.
 *
 * Args:
 *   remoteCommand: a trusted, hard-coded command string (NOT user input).
 *   timeoutMs:     hard wall so the API route can't hang.
 *
 * Returns:
 *   { ok, stdout, stderr } — ok is false on non-zero exit, timeout, or an
 *   unreachable host. Never throws; the caller decides how to surface failure.
 */
export async function runRemote(
  remoteCommand: string,
  timeoutMs = 12_000,
): Promise<RemoteResult> {
  try {
    const { stdout, stderr } = await execAsync(`${sshBase()} "${remoteCommand.replace(/"/g, '\\"')}"`, {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? e.message ?? 'ssh failed',
    };
  }
}

/**
 * Cheap reachability check via a TCP connect to the SSH port on the Tailscale
 * IP. Avoids ICMP (often blocked) and is much faster than a full ssh session.
 */
export async function pcReachable(timeoutMs = 4_000): Promise<boolean> {
  const net = await import('node:net');
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket();
    const done = (result: boolean) => {
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(22, config.pc.ip);
  });
}

/** Pre-baked remote commands used by the /live quick actions.
 *  NOTE: The advisor PC is Windows 10 — commands use cmd/powershell.
 *  Keep commands simple to survive Node→SSH→cmd quoting. */
export const REMOTE_COMMANDS = {
  // Is the audio recorder (ffmpeg) currently running?
  ffmpegRunning: 'tasklist /FI "IMAGENAME eq ffmpeg.exe" /NH 2>nul || echo NONE',
  // Disk usage on the capture drive.
  diskSpace: 'wmic logicaldisk get FreeSpace,Size,Caption /format:list',
  // Newest audio file currently being written, with size.
  latestAudio:
    'dir /O-D /B "C:\\ServiceSync AI\\ambient-sync\\*.mp3" 2>nul | findstr /N "^" | findstr "^[1-3]:"',
  // Is Chrome running (proxy for the extension being able to send events)?
  chromeRunning: 'tasklist /FI "IMAGENAME eq chrome.exe" /NH 2>nul | findstr chrome || echo NONE',
} as const;
