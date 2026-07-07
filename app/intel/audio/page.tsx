/**
 * Audio Explorer (/intel/audio) — player + transcript viewer
 * ====================================================
 * Lists recordings from /api/intel/audio/list, plays the selected one (streamed
 * via /api/intel/audio/stream → presigned S3), and shows its transcript alongside
 * when one exists. Clicking a transcript line seeks the audio. If no transcript
 * exists, a one-click button kicks off an AWS Transcribe job.
 */
'use client';

import { useEffect, useRef, useState } from 'react';
import AudioPlayer, { type AudioPlayerHandle } from '@/components/AudioPlayer';
import TranscriptViewer from '@/components/TranscriptViewer';
import { formatBytes, relativeTime, absoluteTime } from '@/lib/format';
import type { AudioFile, Transcript } from '@/lib/types';

export default function AudioPage() {
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('');

  const [selected, setSelected] = useState<AudioFile | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [transcribeMsg, setTranscribeMsg] = useState('');

  const playerRef = useRef<AudioPlayerHandle>(null);

  // Load the file list once on mount.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/intel/audio/list');
        if (!res.ok) throw new Error(`list failed (${res.status})`);
        const data: AudioFile[] = await res.json();
        setFiles(data);
        if (data.length) selectFile(data[0]);
      } catch (e) {
        setError(String((e as Error).message));
      } finally {
        setLoadingList(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function selectFile(file: AudioFile) {
    setSelected(file);
    setTranscript(null);
    setCurrentTime(0);
    setTranscribeMsg('');
    if (file.hasTranscript && file.transcriptKey) {
      setLoadingTranscript(true);
      try {
        const res = await fetch(`/api/intel/transcripts/${file.transcriptKey}`);
        if (res.ok) setTranscript(await res.json());
      } catch {
        /* leave transcript null; viewer shows the empty state */
      } finally {
        setLoadingTranscript(false);
      }
    }
  }

  async function transcribe() {
    if (!selected) return;
    setTranscribeMsg('Starting transcription job…');
    try {
      const res = await fetch('/api/intel/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioKey: selected.key }),
      });
      const data = await res.json();
      if (res.ok) {
        setTranscribeMsg(`Job ${data.jobName} started (${data.status}). Transcript appears here once complete.`);
      } else {
        setTranscribeMsg(`⚠ ${data.error ?? 'failed to start'}`);
      }
    } catch (e) {
      setTranscribeMsg(`⚠ ${String((e as Error).message)}`);
    }
  }

  const visible = files.filter((f) =>
    f.name.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <div className="px-6 py-5">
      <header className="mb-5">
        <h1 className="font-display text-xl font-bold tracking-tight">Audio Explorer</h1>
        <p className="text-2xs text-muted">
          {files.length} recordings · {files.filter((f) => f.hasTranscript).length} transcribed
        </p>
      </header>

      {error && <div className="card mb-4 text-xs text-danger">Error: {error}</div>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* File list */}
        <div className="flex max-h-[80vh] flex-col">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            className="mb-2 w-full rounded border border-border bg-bg px-2 py-1.5 font-mono text-2xs text-fg outline-none focus:border-cyan"
          />
          <div className="flex-1 space-y-1 overflow-y-auto pr-1">
            {loadingList && <p className="text-xs text-muted">Loading recordings…</p>}
            {!loadingList && visible.length === 0 && (
              <p className="text-xs text-muted">No recordings match.</p>
            )}
            {visible.map((f) => {
              const active = selected?.key === f.key;
              return (
                <button
                  key={f.key}
                  onClick={() => selectFile(f)}
                  className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                    active
                      ? 'border-cyan/60 bg-surface-2'
                      : 'border-border bg-surface hover:border-muted/50'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate font-mono text-2xs text-fg">{f.name}</span>
                    <span
                      className={`dot ${f.hasTranscript ? 'bg-ok' : 'bg-muted'}`}
                      title={f.hasTranscript ? 'transcript available' : 'no transcript'}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[10px] text-muted">
                    <span title={absoluteTime(f.lastModified)}>
                      {relativeTime(f.lastModified)}
                    </span>
                    <span>{formatBytes(f.size)}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Player + transcript */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="space-y-3">
            <AudioPlayer
              ref={playerRef}
              src={selected ? `/api/intel/audio/stream?key=${encodeURIComponent(selected.key)}` : null}
              label={selected?.name}
              onTime={setCurrentTime}
            />
            {selected && !selected.hasTranscript && (
              <div className="card space-y-2">
                <p className="text-xs text-muted">No transcript for this recording.</p>
                <button
                  onClick={transcribe}
                  className="rounded bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                >
                  Transcribe with AWS Transcribe
                </button>
                {transcribeMsg && (
                  <p className="text-2xs text-cyan">{transcribeMsg}</p>
                )}
              </div>
            )}
          </div>

          <div className="min-h-[300px] xl:max-h-[80vh]">
            <TranscriptViewer
              transcript={transcript}
              loading={loadingTranscript}
              currentTime={currentTime}
              onSeek={(s) => playerRef.current?.seek(s)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
