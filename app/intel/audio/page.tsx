/**
 * Audio Explorer — Timeline Scrub Experience
 * ==========================================
 * A rich audio + transcript page with:
 * - Date picker + grouped file list (left sidebar)
 * - Custom audio player with waveform-style timeline (segments as colored blocks)
 * - Synced transcript scroll with active-segment highlighting
 * - Conversation detection (gaps > 30s = boundary)
 * - Stats panel and multi-file day timeline
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusCard from '@/components/StatusCard';
import { formatBytes, formatDuration, relativeTime, todayUTC, clockUTC } from '@/lib/format';
import type { AudioFile, Transcript, TranscriptSegment } from '@/lib/types';

/* ═══════════════════════════════ TYPES ═══════════════════════════════════ */

interface Conversation {
  id: number;
  startTime: number; // seconds into audio
  segments: TranscriptSegment[];
  label: string; // "Conversation 1 — 9:15 AM"
  summary: string; // first few words
}

type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;

/* ═══════════════════════════════ HELPERS ══════════════════════════════════ */

function dateOffset(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function isoToDate(iso: string): string {
  return iso.slice(0, 10);
}

function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

function formatTimeFromSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Detect conversation boundaries: gaps > 30s between segments. */
function detectConversations(
  segments: TranscriptSegment[],
  audioLastModified?: string,
): Conversation[] {
  if (!segments.length) return [];

  const conversations: Conversation[] = [];
  let current: TranscriptSegment[] = [segments[0]];
  let convStart = segments[0].start;

  for (let i = 1; i < segments.length; i++) {
    const gap = segments[i].start - segments[i - 1].end;
    if (gap > 30) {
      // End current conversation
      conversations.push(buildConversation(conversations.length + 1, convStart, current, audioLastModified));
      current = [segments[i]];
      convStart = segments[i].start;
    } else {
      current.push(segments[i]);
    }
  }

  // Push final conversation
  if (current.length) {
    conversations.push(buildConversation(conversations.length + 1, convStart, current, audioLastModified));
  }

  return conversations;
}

function buildConversation(
  id: number,
  startTime: number,
  segments: TranscriptSegment[],
  audioLastModified?: string,
): Conversation {
  // Build a time label from the audio's recording time + segment offset
  let label = `Conversation ${id}`;
  if (audioLastModified) {
    const baseTime = new Date(audioLastModified);
    // Approximate: subtract duration from lastModified to get start, then add segment offset
    const offsetDate = new Date(baseTime.getTime() + startTime * 1000);
    const timeStr = offsetDate.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    label = `Conversation ${id} — ${timeStr}`;
  }

  // Summary: first ~60 chars of the first segment
  const firstText = segments[0]?.text ?? '';
  const summary = firstText.length > 60 ? firstText.slice(0, 60) + '…' : firstText;

  return { id, startTime, segments, label, summary };
}

/** Highlight search term in text with <mark>. */
function highlightText(text: string, query: string) {
  if (!query) return <span>{text}</span>;
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
  return (
    <>
      {parts.map((p, k) =>
        typeof p === 'string' ? (
          <span key={k}>{p}</span>
        ) : (
          <mark key={k} className="rounded bg-cyan/30 text-fg">
            {p.hit}
          </mark>
        ),
      )}
    </>
  );
}

/* ══════════════════════════════ MAIN COMPONENT ════════════════════════════ */

export default function AudioPage() {
  // ─── State ───────────────────────────────────────────────────────────
  const [files, setFiles] = useState<AudioFile[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [error, setError] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayUTC());

  const [selected, setSelected] = useState<AudioFile | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);

  // Playback state
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [isDragging, setIsDragging] = useState(false);

  // Transcript UI
  const [searchQuery, setSearchQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);

  const audioRef = useRef<HTMLAudioElement>(null!);
  const timelineRef = useRef<HTMLDivElement>(null!);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeSegRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number>(0);

  // ─── Data fetching ───────────────────────────────────────────────────
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);

  const loadFiles = async (offsetVal: number, append = false) => {
    try {
      const res = await fetch(`/api/intel/audio/list?limit=30&offset=${offsetVal}`);
      if (!res.ok) throw new Error(`list failed (${res.status})`);
      const data = await res.json();
      setFiles((prev) => append ? [...prev, ...data.files] : data.files);
      setHasMore(data.hasMore);
      setOffset(offsetVal + data.files.length);
    } catch (e) {
      setError(String((e as Error).message));
    } finally {
      setLoadingList(false);
    }
  };

  useEffect(() => {
    loadFiles(0);
  }, []);

  // ─── Derived: files grouped by date ──────────────────────────────────
  const filesByDate = useMemo(() => {
    const map = new Map<string, AudioFile[]>();
    for (const f of files) {
      const date = isoToDate(f.lastModified);
      const arr = map.get(date) ?? [];
      arr.push(f);
      map.set(date, arr);
    }
    // Sort dates descending
    return new Map([...map.entries()].sort(([a], [b]) => b.localeCompare(a)));
  }, [files]);

  const availableDates = useMemo(() => [...filesByDate.keys()], [filesByDate]);

  const todayFiles = useMemo(
    () => filesByDate.get(selectedDate) ?? [],
    [filesByDate, selectedDate],
  );

  // ─── Conversations ───────────────────────────────────────────────────
  const conversations = useMemo(
    () => (transcript ? detectConversations(transcript.segments, selected?.lastModified) : []),
    [transcript, selected],
  );

  // ─── Stats ───────────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const dayFiles = todayFiles;
    const totalRecordings = dayFiles.length;
    const transcribedFiles = dayFiles.filter((f) => f.hasTranscript);
    // Estimate total transcribed time from the current transcript or sum file sizes as proxy
    const totalTranscribedSec = transcript?.durationSec ?? 0;
    const numConversations = conversations.length;
    const avgConvLength =
      numConversations > 0 && transcript
        ? transcript.durationSec / numConversations
        : 0;

    return { totalRecordings, transcribedFiles: transcribedFiles.length, totalTranscribedSec, numConversations, avgConvLength };
  }, [todayFiles, transcript, conversations]);

  // ─── File selection ──────────────────────────────────────────────────
  const selectFile = useCallback(async (file: AudioFile) => {
    setSelected(file);
    setTranscript(null);
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setSearchQuery('');

    // Get stream URL
    setAudioUrl(`/api/intel/audio/stream?key=${encodeURIComponent(file.key)}`);

    // Load transcript if available
    if (file.hasTranscript && file.transcriptKey) {
      setLoadingTranscript(true);
      try {
        const res = await fetch(`/api/intel/transcripts/${file.transcriptKey}`);
        if (res.ok) setTranscript(await res.json());
      } catch {
        /* leave null */
      } finally {
        setLoadingTranscript(false);
      }
    }
  }, []);

  // Auto-select first file when date changes
  useEffect(() => {
    if (todayFiles.length && !selected) {
      selectFile(todayFiles[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayFiles]);

  // ─── Playback controls ───────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
    } else {
      el.pause();
    }
  }, []);

  const seek = useCallback((seconds: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = seconds;
    setCurrentTime(seconds);
  }, []);

  const changeSpeed = useCallback((speed: PlaybackSpeed) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, []);

  // ─── RAF loop for smooth time updates ────────────────────────────────
  useEffect(() => {
    function tick() {
      const el = audioRef.current;
      if (el && !el.paused) {
        setCurrentTime(el.currentTime);
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // ─── Auto-scroll transcript to active segment ────────────────────────
  useEffect(() => {
    if (!autoScroll || !activeSegRef.current || !transcriptRef.current) return;
    activeSegRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentTime, autoScroll]);

  // ─── Timeline scrubber interaction ───────────────────────────────────
  const handleTimelineMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    if (!timelineRef.current || !duration) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seek(pct * duration);
  }, [duration, seek]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!timelineRef.current || !duration) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seek(pct * duration);
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, duration, seek]);

  // ─── Find active segment ─────────────────────────────────────────────
  const activeSegmentIdx = useMemo(() => {
    if (!transcript) return -1;
    return transcript.segments.findIndex(
      (seg) => seg.end > 0 && currentTime >= seg.start && currentTime < seg.end,
    );
  }, [transcript, currentTime]);

  // ─── Filtered segments for search ────────────────────────────────────
  const filteredConversations = useMemo(() => {
    if (!searchQuery) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations
      .map((conv) => ({
        ...conv,
        segments: conv.segments.filter((s) => s.text.toLowerCase().includes(q)),
      }))
      .filter((conv) => conv.segments.length > 0);
  }, [conversations, searchQuery]);

  // ─── Day timeline: show all files on a 24h bar ───────────────────────
  const dayTimelineFiles = useMemo(() => {
    return todayFiles.map((f) => {
      const min = minuteOfDay(f.lastModified);
      // Estimate duration: if we have transcript info for selected file, use it; otherwise estimate from size
      const estDurationMin = f.size / (16000 * 60); // rough: 16KB/s MP3
      return { file: f, startMin: Math.max(0, min - estDurationMin), endMin: min, estDurationMin };
    });
  }, [todayFiles]);

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col px-6 py-5">
      {/* Header */}
      <header className="mb-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">
              Audio Explorer
            </h1>
            <p className="text-2xs text-muted">
              {files.length} recordings · {files.filter((f) => f.hasTranscript).length} transcribed
            </p>
          </div>
        </div>
      </header>

      {error && <div className="card mb-4 text-xs text-danger">Error: {error}</div>}

      {/* ─── Stats Bar ─────────────────────────────────────────── */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatusCard
          label="Recordings Today"
          value={stats.totalRecordings}
          tone="info"
        />
        <StatusCard
          label="Transcribed Time"
          value={stats.totalTranscribedSec > 0 ? formatDuration(stats.totalTranscribedSec) : '—'}
          tone="ok"
        />
        <StatusCard
          label="Conversations"
          value={stats.numConversations}
          tone={stats.numConversations > 0 ? 'info' : 'idle'}
        />
        <StatusCard
          label="Avg Conv. Length"
          value={stats.avgConvLength > 0 ? formatDuration(stats.avgConvLength) : '—'}
          tone="idle"
        />
      </div>

      {/* ─── Multi-File Day Timeline ───────────────────────────── */}
      {todayFiles.length > 1 && (
        <DayTimeline
          files={dayTimelineFiles}
          selectedKey={selected?.key}
          onSelect={selectFile}
        />
      )}

      {/* ─── Main Layout: Sidebar + Player + Transcript ────────── */}
      <div className="flex flex-1 gap-4 overflow-hidden" style={{ maxHeight: 'calc(100vh - 340px)' }}>
        {/* Left Sidebar: Date picker + File list */}
        <div className="hidden w-72 shrink-0 flex-col gap-3 lg:flex">
          {/* Date selector */}
          <div className="card">
            <span className="stat-label mb-2 block">Date</span>
            <input
              type="date"
              value={selectedDate}
              max={todayUTC()}
              onChange={(e) => {
                setSelectedDate(e.target.value);
                setSelected(null);
              }}
              className="w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-xs text-fg outline-none transition-colors focus:border-cyan"
            />
            {/* Quick date buttons */}
            <div className="mt-2 flex gap-1">
              {availableDates.slice(0, 5).map((d) => (
                <button
                  key={d}
                  onClick={() => { setSelectedDate(d); setSelected(null); }}
                  className={`rounded px-2 py-1 font-mono text-2xs transition-colors ${
                    selectedDate === d
                      ? 'bg-cyan/15 text-cyan'
                      : 'text-muted hover:text-fg'
                  }`}
                >
                  {d.slice(5)}
                </button>
              ))}
            </div>
          </div>

          {/* File list */}
          <div className="card flex flex-1 flex-col overflow-hidden">
            <span className="stat-label mb-2 block">
              Recordings ({todayFiles.length})
            </span>
            <div className="flex-1 space-y-1 overflow-y-auto">
              {loadingList && <p className="text-xs text-muted">Loading…</p>}
              {!loadingList && todayFiles.length === 0 && (
                <p className="text-2xs text-muted">No recordings for this date.</p>
              )}
              {todayFiles.map((f) => {
                const active = selected?.key === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => selectFile(f)}
                    className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                      active
                        ? 'border-cyan/60 bg-cyan/5'
                        : 'border-border bg-surface hover:border-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-2xs text-fg">
                        {f.name}
                      </span>
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          f.hasTranscript ? 'bg-ok' : 'bg-muted'
                        }`}
                        title={f.hasTranscript ? 'Transcribed' : 'No transcript'}
                      />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
                      <span>{clockUTC(f.lastModified)}</span>
                      <span>{formatBytes(f.size)}</span>
                    </div>
                  </button>
                );
              })}
              {hasMore && (
                <button
                  onClick={() => loadFiles(offset, true)}
                  className="mt-2 w-full rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted transition-colors hover:border-cyan hover:text-cyan"
                >
                  Load more…
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Content: Player + Transcript */}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden">
          {/* ─── Custom Audio Player ─────────────────────────────── */}
          <AudioPlayerSection
            audioRef={audioRef}
            timelineRef={timelineRef}
            audioUrl={audioUrl}
            selected={selected}
            transcript={transcript}
            currentTime={currentTime}
            duration={duration}
            isPlaying={isPlaying}
            playbackSpeed={playbackSpeed}
            onTogglePlay={togglePlay}
            onChangeSpeed={changeSpeed}
            onTimelineMouseDown={handleTimelineMouseDown}
            onLoadedMetadata={(d) => setDuration(d)}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onTimeUpdate={(t) => setCurrentTime(t)}
          />

          {/* ─── Transcript Scroll ───────────────────────────────── */}
          <div className="card flex flex-1 flex-col overflow-hidden">
            {/* Transcript header */}
            <div className="mb-3 flex items-center justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex items-center gap-3">
                <span className="stat-label">Transcript</span>
                {transcript && (
                  <span className="text-2xs text-muted">
                    {transcript.wordCount.toLocaleString()} words · {conversations.length} conversations
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setAutoScroll(!autoScroll)}
                  className={`rounded px-2 py-1 text-2xs transition-colors ${
                    autoScroll ? 'bg-cyan/15 text-cyan' : 'text-muted hover:text-fg'
                  }`}
                  title="Auto-scroll follows playback"
                >
                  {autoScroll ? '⟳ Sync' : '⟳ Free'}
                </button>
                <input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search transcript…"
                  className="w-40 rounded border border-border bg-bg px-2 py-1 font-mono text-2xs text-fg outline-none focus:border-cyan"
                />
              </div>
            </div>

            {/* Transcript body */}
            <div
              ref={transcriptRef}
              className="-mr-2 flex-1 overflow-y-auto pr-2"
              onScroll={() => {
                // If user manually scrolls, pause auto-scroll briefly
                if (autoScroll && !isPlaying) setAutoScroll(false);
              }}
            >
              {loadingTranscript && (
                <div className="flex items-center gap-2 p-4 text-xs text-muted">
                  <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
                  Loading transcript…
                </div>
              )}
              {!loadingTranscript && !transcript && (
                <div className="p-4 text-center text-xs text-muted">
                  {selected
                    ? selected.hasTranscript
                      ? 'Failed to load transcript.'
                      : 'No transcript for this recording.'
                    : 'Select a recording to view its transcript.'}
                </div>
              )}
              {!loadingTranscript && transcript && filteredConversations.length === 0 && (
                <div className="p-4 text-center text-xs text-muted">
                  No matching segments.
                </div>
              )}
              {!loadingTranscript &&
                transcript &&
                filteredConversations.map((conv) => (
                  <ConversationBlock
                    key={conv.id}
                    conversation={conv}
                    currentTime={currentTime}
                    activeSegmentIdx={activeSegmentIdx}
                    allSegments={transcript.segments}
                    searchQuery={searchQuery}
                    activeSegRef={activeSegRef}
                    onSeek={seek}
                  />
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════ SUB-COMPONENTS ═══════════════════════════════ */

/** Custom audio player with segment-block timeline */
function AudioPlayerSection({
  audioRef,
  timelineRef,
  audioUrl,
  selected,
  transcript,
  currentTime,
  duration,
  isPlaying,
  playbackSpeed,
  onTogglePlay,
  onChangeSpeed,
  onTimelineMouseDown,
  onLoadedMetadata,
  onPlay,
  onPause,
  onTimeUpdate,
}: {
  audioRef: React.RefObject<HTMLAudioElement>;
  timelineRef: React.RefObject<HTMLDivElement>;
  audioUrl: string | null;
  selected: AudioFile | null;
  transcript: Transcript | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackSpeed: PlaybackSpeed;
  onTogglePlay: () => void;
  onChangeSpeed: (speed: PlaybackSpeed) => void;
  onTimelineMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void;
  onLoadedMetadata: (duration: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onTimeUpdate: (time: number) => void;
}) {
  const speeds: PlaybackSpeed[] = [0.5, 1, 1.5, 2];
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="card space-y-3">
      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(e) => onLoadedMetadata(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => onTimeUpdate(e.currentTarget.currentTime)}
        onPlay={onPlay}
        onPause={onPause}
      />

      {/* Top row: file name + playback info */}
      <div className="flex items-center justify-between">
        <span className="truncate font-mono text-xs text-muted">
          {selected?.name ?? 'No file selected'}
        </span>
        <div className="flex items-center gap-3">
          {/* Speed controls */}
          <div className="flex items-center gap-1">
            {speeds.map((s) => (
              <button
                key={s}
                onClick={() => onChangeSpeed(s)}
                className={`rounded px-1.5 py-0.5 font-mono text-2xs transition-colors ${
                  playbackSpeed === s
                    ? 'bg-cyan/15 text-cyan'
                    : 'text-muted hover:text-fg'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>
          {/* Time display */}
          <span className="font-mono text-xs text-fg">
            {formatTimeFromSeconds(currentTime)}
            <span className="text-muted"> / </span>
            {formatTimeFromSeconds(duration)}
          </span>
        </div>
      </div>

      {/* Play button + Timeline */}
      <div className="flex items-center gap-3">
        {/* Play/Pause */}
        <button
          onClick={onTogglePlay}
          disabled={!audioUrl}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface-2 text-fg transition-colors hover:border-cyan hover:text-cyan disabled:opacity-40"
        >
          {isPlaying ? (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Timeline bar with segment blocks */}
        <div
          ref={timelineRef}
          className="relative h-12 flex-1 cursor-crosshair rounded-lg bg-bg"
          onMouseDown={onTimelineMouseDown}
        >
          {/* Segment blocks (colored) */}
          {transcript &&
            duration > 0 &&
            transcript.segments
              .filter((seg) => seg.end > 0)
              .map((seg, i) => {
                const left = (seg.start / duration) * 100;
                const width = Math.max(0.2, ((seg.end - seg.start) / duration) * 100);
                return (
                  <div
                    key={i}
                    className="absolute top-2 h-8 rounded-sm bg-cyan/40 transition-colors hover:bg-cyan/60"
                    style={{ left: `${left}%`, width: `${width}%` }}
                  />
                );
              })}

          {/* Progress fill */}
          <div
            className="absolute left-0 top-0 h-full rounded-l-lg bg-cyan/10 transition-[width] duration-75"
            style={{ width: `${progress}%` }}
          />

          {/* Scrub handle */}
          <div
            className="absolute top-0 z-10 h-full w-0.5 bg-cyan shadow-[0_0_6px_rgba(6,182,212,0.6)] transition-[left] duration-75"
            style={{ left: `${progress}%` }}
          >
            <div className="absolute -left-1.5 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-cyan bg-surface" />
          </div>
        </div>
      </div>
    </div>
  );
}

/** A single conversation group with header + segments */
function ConversationBlock({
  conversation,
  currentTime,
  activeSegmentIdx,
  allSegments,
  searchQuery,
  activeSegRef,
  onSeek,
}: {
  conversation: Conversation;
  currentTime: number;
  activeSegmentIdx: number;
  allSegments: TranscriptSegment[];
  searchQuery: string;
  activeSegRef: React.RefObject<HTMLDivElement>;
  onSeek: (seconds: number) => void;
}) {
  return (
    <div className="mb-4">
      {/* Conversation header */}
      <div className="sticky top-0 z-10 mb-1 flex items-center gap-3 border-b border-border/30 bg-surface/95 px-2 py-2 backdrop-blur-sm">
        <span className="font-mono text-xs font-medium text-cyan">
          {conversation.label}
        </span>
        <span className="truncate text-2xs text-muted italic">
          {conversation.summary}
        </span>
        <span className="ml-auto shrink-0 text-2xs text-muted">
          {conversation.segments.length} segments
        </span>
      </div>

      {/* Segments */}
      {conversation.segments.map((seg, i) => {
        const globalIdx = allSegments.indexOf(seg);
        const isActive = globalIdx === activeSegmentIdx;
        const seekable = seg.end > 0;

        return (
          <div
            key={`${seg.start}-${i}`}
            ref={isActive ? activeSegRef : undefined}
            onClick={seekable ? () => onSeek(seg.start) : undefined}
            className={`flex gap-3 rounded px-2 py-1.5 text-left text-xs transition-all ${
              isActive
                ? 'bg-cyan/10 ring-1 ring-cyan/30'
                : seekable
                  ? 'cursor-pointer hover:bg-surface-2/60'
                  : ''
            }`}
          >
            {/* Timestamp */}
            {seekable && (
              <span
                className={`shrink-0 pt-0.5 font-mono text-2xs ${
                  isActive ? 'text-cyan' : 'text-muted'
                }`}
              >
                {formatTimeFromSeconds(seg.start)}
              </span>
            )}
            {/* Text */}
            <span className={`leading-relaxed ${isActive ? 'text-fg' : 'text-fg/80'}`}>
              {highlightText(seg.text, searchQuery)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Multi-file day timeline — shows all recordings on a 24h bar */
function DayTimeline({
  files,
  selectedKey,
  onSelect,
}: {
  files: { file: AudioFile; startMin: number; endMin: number; estDurationMin: number }[];
  selectedKey?: string;
  onSelect: (file: AudioFile) => void;
}) {
  return (
    <div className="card mb-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="stat-label">Day Timeline (UTC)</span>
        <span className="text-2xs text-muted">{files.length} recordings</span>
      </div>

      <div className="relative h-10 w-full rounded-lg bg-bg">
        {/* Hour gridlines */}
        {Array.from({ length: 25 }, (_, i) => i).map((h) => (
          <div
            key={h}
            className="absolute top-0 h-full border-l border-border/20"
            style={{ left: `${(h / 24) * 100}%` }}
          />
        ))}

        {/* File blocks */}
        {files.map(({ file, startMin, endMin }) => {
          const left = (Math.max(0, startMin) / 1440) * 100;
          const width = Math.max(0.5, ((endMin - startMin) / 1440) * 100);
          const isSelected = file.key === selectedKey;
          return (
            <button
              key={file.key}
              onClick={() => onSelect(file)}
              className={`group absolute top-1.5 h-7 rounded-sm transition-all hover:brightness-125 ${
                isSelected ? 'ring-1 ring-cyan' : ''
              }`}
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: file.hasTranscript ? '#06B6D4' : '#8b949e',
                opacity: isSelected ? 1 : 0.6,
              }}
            >
              {/* Tooltip */}
              <div className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-surface-2 px-2 py-1 text-2xs text-fg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {file.name} · {formatBytes(file.size)}
              </div>
            </button>
          );
        })}
      </div>

      {/* Hour labels */}
      <div className="relative mt-1 h-4 w-full">
        {Array.from({ length: 25 }, (_, i) => i)
          .filter((h) => h % 3 === 0)
          .map((h) => (
            <span
              key={h}
              className="absolute -translate-x-1/2 font-mono text-2xs text-muted"
              style={{ left: `${(h / 24) * 100}%` }}
            >
              {String(h).padStart(2, '0')}
            </span>
          ))}
      </div>
    </div>
  );
}
