/**
 * Rewind — Desktop Capture Timeline Viewer
 * ========================================
 * The "wow" page: full-width screenshots with a scrub timeline, playback mode,
 * and thumbnail strip. Lets dealers rewind an advisor's screen through the day.
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { todayUTC } from '@/lib/format';
import type { BrowserEvent } from '@/lib/types';

/* ═══════════════════════════════ TYPES ═══════════════════════════════════ */

interface Screenshot {
  key: string;
  timestamp: string;
  url: string;
  sizeKB: number;
}

type PlaybackSpeed = 1 | 2 | 5;

/* ═══════════════════════════════ HELPERS ══════════════════════════════════ */

const BUSINESS_START = 7; // 7 AM
const BUSINESS_END = 19; // 7 PM
const BUSINESS_MINUTES = (BUSINESS_END - BUSINESS_START) * 60; // 720

function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

function minuteToBusinessPct(minute: number): number {
  const businessStartMin = BUSINESS_START * 60;
  const clamped = Math.max(businessStartMin, Math.min(BUSINESS_END * 60, minute));
  return ((clamped - businessStartMin) / BUSINESS_MINUTES) * 100;
}

function pctToMinute(pct: number): number {
  return BUSINESS_START * 60 + (pct / 100) * BUSINESS_MINUTES;
}

function formatTimeLabel(minute: number): string {
  const h = Math.floor(minute / 60);
  const m = Math.round(minute % 60);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/* ══════════════════════════════ COMPONENT ═════════════════════════════════ */

export default function RewindPage() {
  // ─── State ───────────────────────────────────────────────────────────
  const [date, setDate] = useState(todayUTC());
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [isDragging, setIsDragging] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [prevUrl, setPrevUrl] = useState<string | null>(null);

  const scrubberRef = useRef<HTMLDivElement>(null);
  const thumbStripRef = useRef<HTMLDivElement>(null);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ─── Data fetching ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setActiveIndex(0);
    setIsPlaying(false);

    const fetchData = async () => {
      try {
        const [screenshotRes, eventsRes] = await Promise.all([
          fetch(`/api/intel/screenshots?date=${date}&advisor_id=siltaylor-chevyland`),
          fetch(`/api/intel/events/range?start=${date}&end=${date}`),
        ]);

        if (!screenshotRes.ok) throw new Error(`Screenshots failed (${screenshotRes.status})`);

        const screenshotData = await screenshotRes.json();
        const eventData = eventsRes.ok ? await eventsRes.json() : [];

        if (!cancelled) {
          setScreenshots(screenshotData.screenshots ?? []);
          setEvents(Array.isArray(eventData) ? eventData : []);
        }
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => { cancelled = true; };
  }, [date]);

  // ─── Playback ────────────────────────────────────────────────────────
  useEffect(() => {
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }

    if (isPlaying && screenshots.length > 0) {
      const intervalMs = 1000 / speed;
      playIntervalRef.current = setInterval(() => {
        setActiveIndex((prev) => {
          if (prev >= screenshots.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    }

    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, speed, screenshots.length]);

  // ─── Crossfade: track previous URL ──────────────────────────────────
  const currentScreenshot = screenshots[activeIndex] ?? null;
  useEffect(() => {
    if (currentScreenshot) {
      setImageLoaded(false);
      // Small delay before clearing previous for crossfade effect
      const timer = setTimeout(() => setPrevUrl(currentScreenshot.url), 300);
      return () => clearTimeout(timer);
    }
  }, [currentScreenshot?.url]);

  // ─── Thumbnail auto-scroll ──────────────────────────────────────────
  useEffect(() => {
    if (!thumbStripRef.current) return;
    const activeThumb = thumbStripRef.current.children[activeIndex] as HTMLElement;
    if (activeThumb) {
      activeThumb.scrollIntoView({
        behavior: 'smooth',
        inline: 'center',
        block: 'nearest',
      });
    }
  }, [activeIndex]);

  // ─── Keyboard navigation ────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setActiveIndex((prev) => Math.max(0, prev - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setActiveIndex((prev) => Math.min(screenshots.length - 1, prev + 1));
          break;
        case ' ':
          e.preventDefault();
          setIsPlaying((prev) => !prev);
          break;
        case 'Escape':
          e.preventDefault();
          setIsFullscreen(false);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screenshots.length]);

  // ─── Scrubber interaction ────────────────────────────────────────────
  const handleScrubberInteraction = useCallback(
    (clientX: number) => {
      if (!scrubberRef.current || !screenshots.length) return;
      const rect = scrubberRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      const targetMinute = pctToMinute(pct);

      // Find nearest screenshot
      let closestIdx = 0;
      let closestDist = Infinity;
      for (let i = 0; i < screenshots.length; i++) {
        const dist = Math.abs(minuteOfDay(screenshots[i].timestamp) - targetMinute);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = i;
        }
      }
      setActiveIndex(closestIdx);
    },
    [screenshots],
  );

  const handleScrubberMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      setIsDragging(true);
      setIsPlaying(false);
      handleScrubberInteraction(e.clientX);
    },
    [handleScrubberInteraction],
  );

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => handleScrubberInteraction(e.clientX);
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleScrubberInteraction]);

  // ─── Correlation: find events near current screenshot ───────────────
  const correlatedEvents = useMemo(() => {
    if (!currentScreenshot || !events.length) return [];
    const screenshotTime = new Date(currentScreenshot.timestamp).getTime();
    // Events within ±30 seconds of this screenshot
    return events
      .filter((e) => {
        const evtTime = new Date(e.timestamp_utc).getTime();
        return Math.abs(evtTime - screenshotTime) < 30_000;
      })
      .slice(0, 5);
  }, [currentScreenshot, events]);

  // ─── Current time indicator ─────────────────────────────────────────
  const nowMinute = useMemo(() => {
    const now = new Date();
    return now.getHours() * 60 + now.getMinutes();
  }, []);

  const isToday = date === todayUTC();

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col overflow-hidden px-4 py-4 lg:px-6" style={{ maxWidth: '100vw' }}>
      {/* ─── Header + Controls ──────────────────────────────────────── */}
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight lg:text-2xl">
            ⏪ Rewind
          </h1>
          <p className="text-2xs text-muted">
            {screenshots.length > 0
              ? `${screenshots.length} captures${date === todayUTC() ? ' today' : ` on ${date}`}`
              : 'Desktop capture timeline'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Playback controls */}
          {screenshots.length > 0 && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPlaying(!isPlaying)}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-fg transition-all hover:border-cyan hover:text-cyan"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="4" width="4" height="16" />
                    <rect x="14" y="4" width="4" height="16" />
                  </svg>
                ) : (
                  <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                    <polygon points="5,3 19,12 5,21" />
                  </svg>
                )}
              </button>

              {/* Speed control */}
              <div className="flex rounded-md border border-border">
                {([1, 2, 5] as PlaybackSpeed[]).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSpeed(s)}
                    className={`px-2 py-1 text-2xs font-mono transition-colors ${
                      speed === s
                        ? 'bg-cyan/15 text-cyan'
                        : 'text-muted hover:text-fg'
                    } ${s === 1 ? 'rounded-l-md' : s === 5 ? 'rounded-r-md' : ''}`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Date picker */}
          <input
            type="date"
            value={date}
            max={todayUTC()}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-md border border-border bg-surface px-3 py-1.5 font-mono text-xs text-fg outline-none transition-colors focus:border-cyan"
          />
        </div>
      </header>

      {/* ─── Error state ────────────────────────────────────────────── */}
      {error && (
        <div className="card mb-3 text-xs text-danger">
          Error loading screenshots: {error}
        </div>
      )}

      {/* ─── Loading state ──────────────────────────────────────────── */}
      {loading && (
        <div className="flex flex-1 flex-col">
          {/* Scrubber skeleton */}
          <div className="mb-3 h-12 animate-pulse rounded-lg bg-surface" />
          {/* Main viewport skeleton */}
          <div className="mb-3 flex-1 animate-pulse rounded-lg bg-surface" style={{ maxHeight: '60vh' }} />
          {/* Thumbnail skeleton */}
          <div className="flex gap-2 overflow-hidden">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 w-28 shrink-0 animate-pulse rounded bg-surface" />
            ))}
          </div>
        </div>
      )}

      {/* ─── Empty state ────────────────────────────────────────────── */}
      {!loading && !error && screenshots.length === 0 && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-surface-2">
              <svg className="h-10 w-10 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
              </svg>
            </div>
            <h2 className="font-display text-lg font-semibold text-fg">No captures for this day</h2>
            <p className="mt-2 text-sm text-muted">
              Desktop screenshots will appear here once the capture agent runs.
            </p>
            <p className="mt-1 text-2xs text-muted/60">
              Try selecting a different date, or check that the agent is active.
            </p>
          </div>
        </div>
      )}

      {/* ─── Main Content (when screenshots exist) ──────────────────── */}
      {!loading && !error && screenshots.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:gap-4">
          {/* ─── Left: Timeline + Viewport + Thumbs ─────────────────── */}
          <div className="flex min-h-0 flex-1 flex-col">
            {/* ─── Timeline Scrubber ──────────────────────────────────── */}
            <div className="card mb-3 p-3">
              <div
                ref={scrubberRef}
                className="relative h-10 w-full cursor-crosshair rounded-md bg-bg"
                onMouseDown={handleScrubberMouseDown}
              >
                {/* Hour gridlines + labels */}
                {Array.from({ length: BUSINESS_END - BUSINESS_START + 1 }, (_, i) => BUSINESS_START + i).map((h) => {
                  const pct = ((h - BUSINESS_START) / (BUSINESS_END - BUSINESS_START)) * 100;
                  return (
                    <div key={h} className="absolute top-0 h-full" style={{ left: `${pct}%` }}>
                      <div className="h-full w-px bg-border/40" />
                      <span className="absolute -bottom-5 -translate-x-1/2 font-mono text-2xs text-muted">
                        {h > 12 ? h - 12 : h}{h >= 12 ? 'p' : 'a'}
                      </span>
                    </div>
                  );
                })}

                {/* Screenshot tick marks */}
                {screenshots.map((s, i) => {
                  const min = minuteOfDay(s.timestamp);
                  const pct = minuteToBusinessPct(min);
                  const isActive = i === activeIndex;
                  return (
                    <div
                      key={s.key}
                      className={`absolute top-1 h-8 w-1 rounded-full transition-all ${
                        isActive ? 'bg-cyan scale-y-110' : 'bg-muted/40 hover:bg-muted'
                      }`}
                      style={{ left: `${pct}%`, transform: `translateX(-50%)` }}
                    />
                  );
                })}

                {/* Current time indicator (today only) */}
                {isToday && nowMinute >= BUSINESS_START * 60 && nowMinute <= BUSINESS_END * 60 && (
                  <div
                    className="absolute top-0 h-full w-0.5 bg-ok/60"
                    style={{ left: `${minuteToBusinessPct(nowMinute)}%` }}
                  >
                    <div className="absolute -top-1 -left-1 h-2.5 w-2.5 rounded-full bg-ok animate-pulse" />
                  </div>
                )}

                {/* Scrub handle */}
                {currentScreenshot && (
                  <div
                    className="absolute top-0 z-10 h-full w-0.5 bg-cyan shadow-[0_0_8px_rgba(6,182,212,0.5)] transition-[left] duration-75"
                    style={{ left: `${minuteToBusinessPct(minuteOfDay(currentScreenshot.timestamp))}%` }}
                  >
                    <div className="absolute -left-2 -top-1.5 h-3 w-4 rounded-sm bg-cyan" />
                    <div className="absolute -left-2 -bottom-1.5 h-3 w-4 rounded-sm bg-cyan" />
                  </div>
                )}
              </div>

              {/* Bottom spacer for hour labels */}
              <div className="h-5" />
            </div>

            {/* ─── Main Viewport ──────────────────────────────────────── */}
            <div
              className={`relative mb-3 flex items-center justify-center rounded-lg border border-border bg-black transition-all ${
                isFullscreen ? 'fixed inset-0 z-50 m-0 rounded-none border-0' : 'flex-1'
              }`}
              style={isFullscreen ? {} : { maxHeight: '60vh', minHeight: '300px' }}
            >
              {currentScreenshot ? (
                <>
                  <img
                    key={currentScreenshot.url}
                    src={currentScreenshot.url}
                    alt={`Screenshot at ${formatTimestamp(currentScreenshot.timestamp)}`}
                    className="max-h-full max-w-full object-contain transition-opacity duration-300"
                    style={{ opacity: imageLoaded ? 1 : 0 }}
                    onLoad={() => setImageLoaded(true)}
                    onClick={() => setIsFullscreen(true)}
                    draggable={false}
                  />

                  {/* Loading shimmer overlay */}
                  {!imageLoaded && (
                    <div className="absolute inset-0 animate-pulse bg-surface/50" />
                  )}

                  {/* Fullscreen toggle */}
                  <button
                    onClick={() => setIsFullscreen(!isFullscreen)}
                    className="absolute right-4 top-4 rounded-md bg-black/70 px-2.5 py-1.5 text-xs font-medium text-fg backdrop-blur-sm transition-colors hover:bg-black/90"
                  >
                    {isFullscreen ? 'Esc · Exit' : 'Click image to expand'}
                  </button>

                  {/* Arrow nav in fullscreen */}
                  {isFullscreen && (
                    <>
                      <button
                        onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}
                        className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-2xl text-white backdrop-blur-sm hover:bg-black/80"
                      >‹</button>
                      <button
                        onClick={() => setActiveIndex(Math.min(screenshots.length - 1, activeIndex + 1))}
                        className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-black/60 p-3 text-2xl text-white backdrop-blur-sm hover:bg-black/80"
                      >›</button>
                    </>
                  )}

                  {/* Timestamp overlay */}
                  <div className="absolute bottom-4 left-4 rounded-md bg-black/70 px-3 py-1.5 backdrop-blur-sm">
                    <span className="font-mono text-sm font-medium text-cyan">
                      {formatTimestamp(currentScreenshot.timestamp)}
                    </span>
                  </div>

                  {/* Index indicator */}
                  <div className="absolute bottom-4 right-4 rounded-md bg-black/70 px-3 py-1.5 backdrop-blur-sm">
                    <span className="font-mono text-2xs text-muted">
                      {activeIndex + 1} / {screenshots.length}
                    </span>
                  </div>

                  {/* Navigation arrows (larger screens) */}
                  <button
                    onClick={() => setActiveIndex((prev) => Math.max(0, prev - 1))}
                    disabled={activeIndex === 0}
                    className="absolute left-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-2 text-fg/70 backdrop-blur-sm transition-all hover:bg-black/80 hover:text-fg disabled:opacity-30 lg:block"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setActiveIndex((prev) => Math.min(screenshots.length - 1, prev + 1))}
                    disabled={activeIndex === screenshots.length - 1}
                    className="absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-full bg-black/50 p-2 text-fg/70 backdrop-blur-sm transition-all hover:bg-black/80 hover:text-fg disabled:opacity-30 lg:block"
                  >
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* Playing indicator */}
                  {isPlaying && (
                    <div className="absolute top-4 left-4 flex items-center gap-2 rounded-md bg-black/70 px-3 py-1.5 backdrop-blur-sm">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-danger" />
                      <span className="font-mono text-2xs text-fg">Playing {speed}x</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-sm text-muted">Select a screenshot</div>
              )}
            </div>

            {/* ─── Thumbnail Strip ────────────────────────────────────── */}
            <div className="shrink-0">
              <div
                ref={thumbStripRef}
                className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin"
                style={{ scrollBehavior: 'smooth' }}
              >
                {screenshots.map((s, i) => (
                  <button
                    key={s.key}
                    onClick={() => setActiveIndex(i)}
                    className={`group relative shrink-0 overflow-hidden rounded-md border-2 transition-all ${
                      i === activeIndex
                        ? 'border-cyan shadow-[0_0_12px_rgba(6,182,212,0.3)]'
                        : 'border-border/50 hover:border-muted'
                    }`}
                    style={{ width: '120px', height: '68px' }}
                  >
                    <img
                      src={s.url}
                      alt={formatTimestamp(s.timestamp)}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      draggable={false}
                    />
                    {/* Time label on hover */}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 py-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <span className="font-mono text-2xs text-white">
                        {formatTimestamp(s.timestamp)}
                      </span>
                    </div>
                    {/* Active indicator dot */}
                    {i === activeIndex && (
                      <div className="absolute top-1 right-1 h-2 w-2 rounded-full bg-cyan" />
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ─── Correlation Panel (right sidebar / below on mobile) ── */}
          <aside className="mt-4 w-full shrink-0 lg:mt-0 lg:w-72">
            <div className="card h-full">
              <h3 className="stat-label mb-3">At This Moment</h3>

              {correlatedEvents.length > 0 ? (
                <div className="space-y-3">
                  {correlatedEvents.map((evt, i) => (
                    <div key={evt.event_id || i} className="rounded-md border border-border/50 bg-bg p-3">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-cyan" />
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-fg truncate">
                            {evt.window_title || 'Unknown Window'}
                          </p>
                          {evt.system && (
                            <p className="text-2xs text-cyan">{evt.system}</p>
                          )}
                          {evt.url && (
                            <p className="mt-1 truncate text-2xs text-muted">
                              {evt.url}
                            </p>
                          )}
                          <p className="mt-1 text-2xs text-muted/60">
                            {evt.interaction_type || 'page_view'} · {evt.duration_sec}s
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Link to activity page */}
                  <a
                    href={`/intel/activity`}
                    className="mt-2 block text-center text-2xs text-cyan hover:underline"
                  >
                    View full activity timeline →
                  </a>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="rounded-md border border-border/30 bg-bg/50 p-3 text-center">
                    <p className="text-2xs text-muted">
                      No browser events at this moment
                    </p>
                  </div>
                </div>
              )}

              {/* AI Tags placeholder */}
              <div className="mt-4 border-t border-border pt-4">
                <h4 className="stat-label mb-2">AI Screen Analysis</h4>
                <div className="rounded-md border border-dashed border-border/50 bg-bg/30 p-3 text-center">
                  <span className="text-2xs text-muted/60">
                    🧠 AI-generated screen tags coming soon
                  </span>
                </div>
              </div>

              {/* Screenshot metadata */}
              {currentScreenshot && (
                <div className="mt-4 border-t border-border pt-4">
                  <h4 className="stat-label mb-2">Capture Info</h4>
                  <div className="space-y-1.5 text-2xs">
                    <div className="flex justify-between">
                      <span className="text-muted">Time</span>
                      <span className="font-mono text-fg">{formatTimestamp(currentScreenshot.timestamp)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Size</span>
                      <span className="font-mono text-fg">{currentScreenshot.sizeKB} KB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">Index</span>
                      <span className="font-mono text-fg">{activeIndex + 1} of {screenshots.length}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
