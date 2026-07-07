/**
 * Live Status (/live) — real-time monitoring + remote actions
 * ===========================================================
 * Polls /api/status every 30s for PC reachability + capture/extension freshness
 * and offers quick actions that SSH into the dealership PC (check ffmpeg, disk,
 * latest audio, Chrome) plus a one-click transcribe of the newest recording.
 * Action output is shown raw in a terminal-style pane.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import StatusCard from '@/components/StatusCard';
import { relativeTime, absoluteTime } from '@/lib/format';
import type { SystemStatus } from '@/lib/types';

const POLL_MS = 30_000;

interface ActionState {
  running: boolean;
  output: string;
}

const QUICK_ACTIONS: { id: string; label: string }[] = [
  { id: 'ffmpeg', label: 'Check audio recorder (ffmpeg)' },
  { id: 'latestAudio', label: 'Latest audio file' },
  { id: 'chrome', label: 'Is Chrome running?' },
  { id: 'disk', label: 'Check disk space' },
];

export default function LivePage() {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState<ActionState>({ running: false, output: '' });

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/intel/status', { cache: 'no-store' });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStatus(await res.json());
      setError('');
    } catch (e) {
      setError(String((e as Error).message));
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  async function runAction(id: string, label: string) {
    setAction({ running: true, output: `$ ${label}\n…` });
    try {
      const res = await fetch('/api/intel/live/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: id }),
      });
      const data = await res.json();
      const body = data.ok
        ? data.stdout || '(no output)'
        : `✗ ${data.stderr || data.error || 'failed'}`;
      setAction({ running: false, output: `$ ${label}\n${body}` });
    } catch (e) {
      setAction({ running: false, output: `$ ${label}\n✗ ${String((e as Error).message)}` });
    }
  }

  async function transcribeLatest() {
    setAction({ running: true, output: '$ Trigger transcript for latest file\n…' });
    try {
      // Grab the newest recording, then start a job on it.
      const listRes = await fetch('/api/intel/audio/list');
      const files = await listRes.json();
      const newest = Array.isArray(files) ? files[0] : null;
      if (!newest) {
        setAction({ running: false, output: 'No audio files found.' });
        return;
      }
      const res = await fetch('/api/intel/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioKey: newest.key }),
      });
      const data = await res.json();
      setAction({
        running: false,
        output: res.ok
          ? `$ Transcribe ${newest.name}\nJob ${data.jobName} → ${data.status}`
          : `$ Transcribe ${newest.name}\n✗ ${data.error}`,
      });
    } catch (e) {
      setAction({ running: false, output: `✗ ${String((e as Error).message)}` });
    }
  }

  return (
    <div className="px-6 py-5">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">Live Status</h1>
          <p className="text-2xs text-muted">
            Auto-refresh every 30s · last check {relativeTime(status?.checkedAt)}
          </p>
        </div>
        <span className="flex items-center gap-2 text-2xs text-muted">
          <span className="dot animate-pulse bg-ok" /> polling
        </span>
      </header>

      {error && <div className="card mb-4 text-xs text-danger">Status error: {error}</div>}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatusCard
          label="Dealer PC"
          value={status ? (status.pcOnline ? 'Online' : 'Offline') : '…'}
          tone={status?.pcOnline ? 'ok' : 'danger'}
        />
        <StatusCard
          label="Audio Capture"
          value={status ? (status.audioCapturing ? 'Recording' : 'Stale') : '…'}
          tone={status?.audioCapturing ? 'ok' : 'warn'}
          sub={`upload ${relativeTime(status?.lastAudioUpload)}`}
          title={absoluteTime(status?.lastAudioUpload)}
        />
        <StatusCard
          label="Extension"
          value={status ? (status.extensionActive ? 'Active' : 'Idle') : '…'}
          tone={status?.extensionActive ? 'ok' : 'warn'}
          sub={`event ${relativeTime(status?.lastEvent)}`}
          title={absoluteTime(status?.lastEvent)}
        />
        <StatusCard
          label="Last Event"
          value={relativeTime(status?.lastEvent)}
          tone="info"
          title={absoluteTime(status?.lastEvent)}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {/* Quick actions */}
        <div>
          <h2 className="stat-label mb-2">Quick actions</h2>
          <div className="space-y-2">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.id}
                disabled={action.running}
                onClick={() => runAction(a.id, a.label)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-left text-xs text-fg/90 transition-colors hover:border-cyan/50 disabled:opacity-50"
              >
                {a.label}
              </button>
            ))}
            <button
              disabled={action.running}
              onClick={transcribeLatest}
              className="w-full rounded-md border border-brand/40 bg-brand/10 px-3 py-2 text-left text-xs font-semibold text-brand transition-colors hover:bg-brand/20 disabled:opacity-50"
            >
              Trigger transcript for latest file
            </button>
          </div>
          <p className="mt-3 text-[10px] leading-relaxed text-muted">
            Remote actions SSH into the PC over Tailscale ({/* IP from server */}
            <span className="font-mono">100.104.185.115</span>). Requires the deploy
            key to be present on the server running this dashboard.
          </p>
        </div>

        {/* Output pane */}
        <div>
          <h2 className="stat-label mb-2">Output</h2>
          <pre className="card min-h-[200px] overflow-x-auto whitespace-pre-wrap bg-bg font-mono text-2xs leading-relaxed text-ok">
            {action.output || '$ ready — run an action.'}
            {action.running && <span className="animate-pulse"> ▋</span>}
          </pre>
        </div>
      </div>
    </div>
  );
}
