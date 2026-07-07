/**
 * TranscriptViewer — timestamped transcript with click-to-seek + search
 * =====================================================================
 * Renders a transcript's segments as clickable lines (clicking a timestamp
 * tells the parent to seek the audio there). Highlights the segment matching
 * the current playback position, and supports an in-transcript search box that
 * filters + highlights matching segments.
 */
'use client';

import { useMemo, useState } from 'react';
import { formatDuration } from '@/lib/format';
import type { Transcript } from '@/lib/types';

interface Props {
  transcript: Transcript | null;
  loading?: boolean;
  currentTime?: number;
  onSeek?: (seconds: number) => void;
}

/** Split text around a query (case-insensitive) for <mark> highlighting. */
function highlight(text: string, query: string) {
  if (!query) return text;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const parts: (string | { hit: string })[] = [];
  let i = 0;
  let idx = lower.indexOf(q);
  while (idx !== -1) {
    if (idx > i) parts.push(text.slice(i, idx));
    parts.push({ hit: text.slice(idx, idx + q.length) });
    i = idx + q.length;
    idx = lower.indexOf(q, i);
  }
  if (i < text.length) parts.push(text.slice(i));
  return parts.map((p, k) =>
    typeof p === 'string' ? (
      <span key={k}>{p}</span>
    ) : (
      <mark key={k} className="rounded bg-cyan/30 text-fg">
        {p.hit}
      </mark>
    ),
  );
}

export default function TranscriptViewer({
  transcript,
  loading,
  currentTime = 0,
  onSeek,
}: Props) {
  const [query, setQuery] = useState('');

  const segments = useMemo(() => {
    if (!transcript) return [];
    if (!query) return transcript.segments;
    const q = query.toLowerCase();
    return transcript.segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [transcript, query]);

  if (loading) {
    return <div className="card text-xs text-muted">Loading transcript…</div>;
  }
  if (!transcript) {
    return (
      <div className="card text-xs text-muted">
        No transcript for this recording yet. Use “Transcribe” to generate one.
      </div>
    );
  }

  return (
    <div className="card flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-2xs text-muted">
          {transcript.wordCount.toLocaleString()} words ·{' '}
          {formatDuration(transcript.durationSec)}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search transcript…"
          className="w-40 rounded border border-border bg-bg px-2 py-1 font-mono text-2xs text-fg outline-none focus:border-cyan"
        />
      </div>

      <div className="-mr-2 flex-1 space-y-0.5 overflow-y-auto pr-2">
        {segments.length === 0 && (
          <p className="text-2xs text-muted">No matching lines.</p>
        )}
        {segments.map((seg, i) => {
          const active =
            currentTime >= seg.start && currentTime < (seg.end || seg.start + 5);
          return (
            <button
              key={`${seg.start}-${i}`}
              onClick={() => onSeek?.(seg.start)}
              className={`flex w-full gap-3 rounded px-2 py-1 text-left text-xs transition-colors ${
                active ? 'bg-cyan/10' : 'hover:bg-surface-2/60'
              }`}
            >
              <span
                className={`shrink-0 font-mono text-2xs ${
                  active ? 'text-cyan' : 'text-muted'
                }`}
              >
                {formatDuration(seg.start)}
              </span>
              <span className="leading-relaxed text-fg/90">
                {highlight(seg.text, query)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
