/**
 * Browser Activity — Timeline Scrub Experience
 * =============================================
 * A rich, scrollable timeline-scrub page that lets the user:
 * - Select date ranges (Today, Yesterday, Last 7/30 days, or a custom date)
 * - Scrub through a horizontal timeline with colored session blocks
 * - View a synced vertical event feed grouped by sessions
 * - See screenshots (placeholder until capture is live)
 * - View multi-day bar charts and trend data for ranges
 */
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import StatusCard from '@/components/StatusCard';
import { summarize, buildSessions, classifySystem } from '@/lib/analyze';
import { colorForLabel, SYSTEM_COLORS } from '@/lib/colors';
import { todayUTC, formatMinutes, formatDuration, clockUTC } from '@/lib/format';
import type { BrowserEvent, ActivitySession } from '@/lib/types';

/* ═══════════════════════════════ TYPES ═══════════════════════════════════ */

type RangePreset = 'today' | 'yesterday' | '7d' | '30d' | 'custom';

interface ScreenshotEntry {
  timestamp: string;
  url: string;
  key: string;
}

/* ═══════════════════════════════ HELPERS ══════════════════════════════════ */

function dateOffset(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().slice(0, 10);
}

function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  return d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(11, 19);
}

function truncateUrl(url: string | undefined, max = 50): string {
  if (!url) return '';
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? u.pathname.slice(0, 30) + '…' : u.pathname;
    const host = u.hostname.replace('www.', '');
    const full = `${host}${path}`;
    return full.length > max ? full.slice(0, max) + '…' : full;
  } catch {
    return url.length > max ? url.slice(0, max) + '…' : url;
  }
}

function isMultiDay(start: string, end: string): boolean {
  return start !== end;
}

/* ══════════════════════════════ COMPONENT ═════════════════════════════════ */

export default function ActivityPage() {
  // ─── State ───────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<RangePreset>('today');
  const [customDate, setCustomDate] = useState(todayUTC());
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scrubMinute, setScrubMinute] = useState(0); // 0-1440 position for single day
  const [isDragging, setIsDragging] = useState(false);

  const feedRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const eventRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ─── Date range calculation ──────────────────────────────────────────
  const { startDate, endDate } = useMemo(() => {
    switch (preset) {
      case 'today':
        return { startDate: todayUTC(), endDate: todayUTC() };
      case 'yesterday':
        return { startDate: dateOffset(1), endDate: dateOffset(1) };
      case '7d':
        return { startDate: dateOffset(6), endDate: todayUTC() };
      case '30d':
        return { startDate: dateOffset(29), endDate: todayUTC() };
      case 'custom':
        return { startDate: customDate, endDate: customDate };
    }
  }, [preset, customDate]);

  const multiDay = isMultiDay(startDate, endDate);

  // ─── Data fetching ───────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');

    (async () => {
      try {
        const url = multiDay
          ? `/api/intel/events/range?start=${startDate}&end=${endDate}`
          : `/api/intel/events?date=${startDate}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`events failed (${res.status})`);
        const data: BrowserEvent[] = await res.json();
        if (!cancelled) setEvents(data);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    // Fetch screenshots for single day
    if (!multiDay) {
      fetch(`/api/intel/screenshots?date=${startDate}`)
        .then((r) => r.json())
        .then((data) => { if (!cancelled) setScreenshots(data); })
        .catch(() => { if (!cancelled) setScreenshots([]); });
    } else {
      setScreenshots([]);
    }

    return () => { cancelled = true; };
  }, [startDate, endDate, multiDay]);

  // ─── Derived data ────────────────────────────────────────────────────
  const summary = useMemo(() => summarize(events), [events]);
  const sessions = useMemo(() => buildSessions(events), [events]);
  const rapidSessions = useMemo(() => sessions.filter((s) => s.rapidSwitch), [sessions]);

  // Events grouped by session for the feed
  const sessionGroups = useMemo(() => {
    const groups: { session: ActivitySession; events: BrowserEvent[] }[] = [];
    if (!sessions.length) return groups;

    let sIdx = 0;
    let currentGroup: BrowserEvent[] = [];

    for (const evt of events) {
      const evtTime = new Date(evt.timestamp_utc).getTime();
      // Find which session this event belongs to
      while (
        sIdx < sessions.length - 1 &&
        evtTime > new Date(sessions[sIdx].end).getTime()
      ) {
        if (currentGroup.length) {
          groups.push({ session: sessions[sIdx], events: currentGroup });
          currentGroup = [];
        }
        sIdx++;
      }
      currentGroup.push(evt);
    }
    if (currentGroup.length && sIdx < sessions.length) {
      groups.push({ session: sessions[sIdx], events: currentGroup });
    }
    return groups;
  }, [events, sessions]);

  // ─── Scrubber interaction ────────────────────────────────────────────
  const handleScrubberClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!scrubberRef.current) return;
    const rect = scrubberRef.current.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const minute = Math.round(pct * 1440);
    setScrubMinute(minute);
    scrollFeedToMinute(minute);
  }, []);

  const handleScrubberMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    handleScrubberClick(e);
  }, [handleScrubberClick]);

  useEffect(() => {
    if (!isDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      if (!scrubberRef.current) return;
      const rect = scrubberRef.current.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const minute = Math.round(pct * 1440);
      setScrubMinute(minute);
      scrollFeedToMinute(minute);
    };
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // Scroll the event feed to the event nearest the given minute
  const scrollFeedToMinute = useCallback((minute: number) => {
    if (!events.length) return;
    // Find the event closest to this minute of the day
    let closestIdx = 0;
    let closestDist = Infinity;
    for (let i = 0; i < events.length; i++) {
      const evtMin = minuteOfDay(events[i].timestamp_utc);
      const dist = Math.abs(evtMin - minute);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }
    const el = eventRefs.current.get(closestIdx);
    if (el && feedRef.current) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [events]);

  // When user clicks an event, update scrubber position
  const handleEventClick = useCallback((eventIdx: number) => {
    if (!events[eventIdx]) return;
    const minute = minuteOfDay(events[eventIdx].timestamp_utc);
    setScrubMinute(Math.round(minute));
  }, [events]);

  // Sync scrub position on scroll
  const handleFeedScroll = useCallback(() => {
    if (isDragging || !feedRef.current || !events.length) return;
    const container = feedRef.current;
    const containerRect = container.getBoundingClientRect();
    const centerY = containerRect.top + containerRect.height / 2;

    // Find the event element closest to the center of the viewport
    let closestIdx = 0;
    let closestDist = Infinity;
    eventRefs.current.forEach((el, idx) => {
      const rect = el.getBoundingClientRect();
      const elCenter = rect.top + rect.height / 2;
      const dist = Math.abs(elCenter - centerY);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = idx;
      }
    });

    if (events[closestIdx]) {
      const minute = minuteOfDay(events[closestIdx].timestamp_utc);
      setScrubMinute(Math.round(minute));
    }
  }, [isDragging, events]);

  // ─── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col px-6 py-5">
      {/* Header + Date Range Selector */}
      <header className="mb-5">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight">
              Browser Activity
            </h1>
            <p className="text-2xs text-muted">
              {events.length} events · {startDate}
              {multiDay ? ` → ${endDate}` : ''}
            </p>
          </div>
        </div>

        {/* Date controls */}
        <div className="flex flex-wrap items-center gap-2">
          {(['today', 'yesterday', '7d', '30d'] as RangePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-all ${
                preset === p
                  ? 'border-cyan bg-cyan/10 text-cyan'
                  : 'border-border bg-surface text-muted hover:border-muted hover:text-fg'
              }`}
            >
              {p === 'today' ? 'Today' : p === 'yesterday' ? 'Yesterday' : p === '7d' ? 'Last 7 Days' : 'Last 30 Days'}
            </button>
          ))}
          <div className="flex items-center gap-1">
            <input
              type="date"
              value={customDate}
              max={todayUTC()}
              onChange={(e) => {
                setCustomDate(e.target.value);
                setPreset('custom');
              }}
              className="rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg outline-none transition-colors focus:border-cyan"
            />
          </div>
        </div>
      </header>

      {error && <div className="card mb-4 text-xs text-danger">Error: {error}</div>}
      {loading && (
        <div className="card flex items-center gap-2 text-xs text-muted">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-cyan border-t-transparent" />
          Loading events…
        </div>
      )}

      {!loading && (
        <>
          {/* ─── Stats Bar ─────────────────────────────────────────── */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatusCard
              label="Active Time"
              value={formatMinutes(summary.totalHours * 60)}
              tone="info"
            />
            <StatusCard
              label="Idle Time"
              value={formatMinutes(summary.idleMinutes)}
              tone={summary.idleMinutes > 60 ? 'warn' : 'idle'}
            />
            <StatusCard
              label="Switches / hr"
              value={summary.avgSwitchesPerHour}
              tone={summary.avgSwitchesPerHour >= 12 ? 'warn' : 'idle'}
            />
            <StatusCard
              label="Friction Bursts"
              value={rapidSessions.length}
              tone={rapidSessions.length > 0 ? 'danger' : 'ok'}
              sub="3+ tools in <2 min"
            />
          </div>

          {/* ─── Multi-Day Bar Chart ───────────────────────────────── */}
          {multiDay && summary.byDay.length > 0 && (
            <MultiDayChart byDay={summary.byDay} />
          )}

          {/* ─── Single Day: Timeline Scrubber ─────────────────────── */}
          {!multiDay && (
            <div className="card mb-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="stat-label">Timeline Scrubber (UTC)</span>
                <span className="font-mono text-xs text-cyan">
                  {String(Math.floor(scrubMinute / 60)).padStart(2, '0')}:
                  {String(scrubMinute % 60).padStart(2, '0')}
                </span>
              </div>

              {/* Scrubber bar */}
              <div
                ref={scrubberRef}
                className="relative h-16 w-full cursor-crosshair rounded-lg bg-bg"
                onMouseDown={handleScrubberMouseDown}
              >
                {/* Hour gridlines */}
                {Array.from({ length: 25 }, (_, i) => i).map((h) => (
                  <div
                    key={h}
                    className="absolute top-0 h-full border-l border-border/30"
                    style={{ left: `${(h / 24) * 100}%` }}
                  />
                ))}

                {/* Session blocks */}
                {sessions.map((s, i) => {
                  const startMin = minuteOfDay(s.start);
                  const endMin = Math.min(1440, startMin + s.durationSec / 60);
                  const left = (startMin / 1440) * 100;
                  const width = Math.max(0.3, ((endMin - startMin) / 1440) * 100);
                  const color = colorForLabel(s.systems[0] ?? 'Other');
                  return (
                    <div
                      key={i}
                      className="group absolute top-3 h-10 rounded-sm transition-all hover:brightness-125"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: color,
                        opacity: 0.8,
                      }}
                    >
                      {/* Tooltip */}
                      <div className="pointer-events-none absolute -top-10 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-surface-2 px-2 py-1 text-2xs text-fg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                        {clockUTC(s.start)} – {clockUTC(s.end)} · {formatDuration(s.durationSec)} · {s.systems.join(', ')}
                      </div>
                      {s.rapidSwitch && (
                        <span className="absolute -top-1 right-0 h-2 w-2 rounded-full bg-danger ring-2 ring-bg" />
                      )}
                    </div>
                  );
                })}

                {/* Scrub handle */}
                <div
                  className="absolute top-0 z-10 h-full w-0.5 bg-cyan shadow-[0_0_6px_rgba(6,182,212,0.6)] transition-[left] duration-75"
                  style={{ left: `${(scrubMinute / 1440) * 100}%` }}
                >
                  <div className="absolute -left-1.5 -top-1 h-3 w-3.5 rounded-sm bg-cyan" />
                  <div className="absolute -left-1.5 -bottom-1 h-3 w-3.5 rounded-sm bg-cyan" />
                </div>
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
          )}

          {/* ─── Main content: Feed + Screenshot Panel ─────────────── */}
          {!multiDay && (
            <div className="flex flex-1 gap-4 overflow-hidden">
              {/* Event Feed */}
              <div
                ref={feedRef}
                onScroll={handleFeedScroll}
                className="flex-1 overflow-y-auto rounded-lg border border-border"
                style={{ maxHeight: 'calc(100vh - 420px)' }}
              >
                {sessionGroups.length === 0 ? (
                  <div className="p-6 text-center text-xs text-muted">
                    No events for this day.
                  </div>
                ) : (
                  sessionGroups.map((group, gIdx) => (
                    <SessionGroup
                      key={gIdx}
                      session={group.session}
                      events={group.events}
                      globalEvents={events}
                      eventRefs={eventRefs}
                      onEventClick={handleEventClick}
                      screenshots={screenshots}
                    />
                  ))
                )}
              </div>

              {/* Screenshot Panel */}
              <ScreenshotPanel screenshots={screenshots} scrubMinute={scrubMinute} />
            </div>
          )}

          {/* ─── Multi-Day: Daily Summary Cards ────────────────────── */}
          {multiDay && (
            <MultiDaySummary
              events={events}
              sessions={sessions}
              byDay={summary.byDay}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ═════════════════════════ SUB-COMPONENTS ═════════════════════════════════ */

/** Multi-day bar chart showing activity volume per day */
function MultiDayChart({
  byDay,
}: {
  byDay: { date: string; events: number; minutes: number }[];
}) {
  const maxMin = Math.max(...byDay.map((d) => d.minutes), 1);
  return (
    <div className="card mb-4">
      <span className="stat-label mb-3 block">Daily Activity Volume</span>
      <div className="flex items-end gap-1" style={{ height: 120 }}>
        {byDay.map((day) => {
          const height = Math.max(4, (day.minutes / maxMin) * 100);
          return (
            <div
              key={day.date}
              className="group relative flex flex-1 flex-col items-center justify-end"
              style={{ height: '100%' }}
            >
              <div
                className="w-full max-w-[32px] rounded-t bg-cyan/70 transition-all hover:bg-cyan"
                style={{ height: `${height}%` }}
              />
              <span className="mt-1 text-2xs text-muted">
                {day.date.slice(5)}
              </span>
              {/* Tooltip */}
              <div className="pointer-events-none absolute -top-8 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-surface-2 px-2 py-1 text-2xs text-fg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {day.date}: {formatMinutes(day.minutes)} · {day.events} events
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Session group in the event feed */
function SessionGroup({
  session,
  events: groupEvents,
  globalEvents,
  eventRefs,
  onEventClick,
  screenshots,
}: {
  session: ActivitySession;
  events: BrowserEvent[];
  globalEvents: BrowserEvent[];
  eventRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onEventClick: (idx: number) => void;
  screenshots: ScreenshotEntry[];
}) {
  // Build system breakdown for header
  const systemCounts: Record<string, number> = {};
  for (const e of groupEvents) {
    const sys = classifySystem(e);
    systemCounts[sys.label] = (systemCounts[sys.label] ?? 0) + (e.duration_sec || 0);
  }

  return (
    <div className="border-b border-border/50 last:border-b-0">
      {/* Session header */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border/30 bg-surface-2/95 px-4 py-2 backdrop-blur-sm">
        <span className="font-mono text-xs text-cyan">
          {clockUTC(session.start)} – {clockUTC(session.end)}
        </span>
        <span className="text-2xs text-muted">
          {formatDuration(session.durationSec)} · {session.eventCount} events · {session.switches} switches
        </span>
        <div className="flex gap-1">
          {Object.entries(systemCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 4)
            .map(([label, secs]) => (
              <span
                key={label}
                className="rounded px-1.5 py-0.5 text-2xs font-medium"
                style={{
                  backgroundColor: colorForLabel(label) + '20',
                  color: colorForLabel(label),
                }}
              >
                {label}
              </span>
            ))}
        </div>
        {session.rapidSwitch && (
          <span className="badge bg-danger/15 text-danger">⚡ rapid-switch</span>
        )}
      </div>

      {/* Events */}
      {groupEvents.map((evt) => {
        const globalIdx = globalEvents.indexOf(evt);
        const sys = classifySystem(evt);
        const hasScreenshot = screenshots.some((s) => {
          const sDiff = Math.abs(
            new Date(s.timestamp).getTime() - new Date(evt.timestamp_utc).getTime()
          );
          return sDiff < 30000; // within 30 seconds
        });

        return (
          <div
            key={evt.event_id || globalIdx}
            ref={(el) => {
              if (el) eventRefs.current.set(globalIdx, el);
            }}
            onClick={() => onEventClick(globalIdx)}
            className="group flex cursor-pointer items-center gap-3 px-4 py-2 transition-colors hover:bg-surface-2/60"
          >
            {/* Timestamp */}
            <span className="w-14 shrink-0 font-mono text-2xs text-muted">
              {formatTime(evt.timestamp_utc).slice(0, 5)}
            </span>

            {/* System badge */}
            <span
              className="w-20 shrink-0 truncate rounded px-1.5 py-0.5 text-center text-2xs font-medium"
              style={{
                backgroundColor: colorForLabel(sys.label) + '20',
                color: colorForLabel(sys.label),
              }}
            >
              {sys.label}
            </span>

            {/* Title + URL */}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-fg">
                {evt.window_title || 'Untitled'}
              </div>
              <div className="truncate text-2xs text-muted">
                {truncateUrl(evt.url)}
              </div>
            </div>

            {/* Duration */}
            <span className="shrink-0 font-mono text-2xs text-muted">
              {evt.duration_sec ? formatDuration(evt.duration_sec) : '—'}
            </span>

            {/* Screenshot indicator */}
            {hasScreenshot && (
              <span className="shrink-0 text-xs text-cyan" title="Screenshot available">
                📷
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Screenshot panel — shows placeholder until capture is live */
function ScreenshotPanel({
  screenshots,
  scrubMinute,
}: {
  screenshots: ScreenshotEntry[];
  scrubMinute: number;
}) {
  // Find screenshot nearest to current scrub position
  const nearestScreenshot = useMemo(() => {
    if (!screenshots.length) return null;
    let closest: ScreenshotEntry | null = null;
    let closestDist = Infinity;
    for (const s of screenshots) {
      const sMin = minuteOfDay(s.timestamp);
      const dist = Math.abs(sMin - scrubMinute);
      if (dist < closestDist) {
        closestDist = dist;
        closest = s;
      }
    }
    return closestDist < 10 ? closest : null; // within 10 min
  }, [screenshots, scrubMinute]);

  return (
    <div className="hidden w-72 shrink-0 flex-col gap-3 lg:flex">
      <div className="card flex flex-1 flex-col items-center justify-center text-center">
        {nearestScreenshot ? (
          <div className="w-full">
            <img
              src={nearestScreenshot.url}
              alt="Screenshot"
              className="w-full rounded border border-border"
            />
            <p className="mt-2 text-2xs text-muted">
              {clockUTC(nearestScreenshot.timestamp)}
            </p>
          </div>
        ) : (
          <>
            <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-surface-2">
              <svg
                className="h-8 w-8 text-muted"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z"
                />
              </svg>
            </div>
            <p className="text-xs font-medium text-fg">Screenshot capture</p>
            <p className="mt-1 text-2xs text-muted">Coming soon</p>
            <p className="mt-2 text-2xs text-muted/60">
              Periodic screenshots will appear here when the capture agent is deployed.
            </p>
          </>
        )}
      </div>

      {/* System Legend */}
      <div className="card">
        <span className="stat-label mb-2 block">Systems</span>
        <div className="space-y-1.5">
          {Object.entries(SYSTEM_COLORS).map(([key, color]) => (
            <div key={key} className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: color }}
              />
              <span className="text-2xs text-muted capitalize">{key}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Multi-day summary with daily cards and trend */
function MultiDaySummary({
  events,
  sessions,
  byDay,
}: {
  events: BrowserEvent[];
  sessions: ActivitySession[];
  byDay: { date: string; events: number; minutes: number }[];
}) {
  // Group sessions by day
  const sessionsByDay = useMemo(() => {
    const map = new Map<string, ActivitySession[]>();
    for (const s of sessions) {
      const day = s.start.slice(0, 10);
      const arr = map.get(day) ?? [];
      arr.push(s);
      map.set(day, arr);
    }
    return map;
  }, [sessions]);

  return (
    <div className="space-y-4">
      {/* Trend line */}
      <div className="card">
        <span className="stat-label mb-3 block">Activity Hours Trend</span>
        <div className="flex items-end gap-0.5" style={{ height: 80 }}>
          {byDay.map((day, i) => {
            const hours = day.minutes / 60;
            const maxHours = Math.max(...byDay.map((d) => d.minutes / 60), 1);
            const height = Math.max(2, (hours / maxHours) * 100);
            return (
              <div
                key={day.date}
                className="group relative flex flex-1 flex-col items-center justify-end"
                style={{ height: '100%' }}
              >
                <div
                  className="w-full max-w-[24px] rounded-t transition-all"
                  style={{
                    height: `${height}%`,
                    backgroundColor: hours > 0 ? '#06B6D4' : '#30363d',
                    opacity: 0.7 + (i / byDay.length) * 0.3,
                  }}
                />
                <div className="pointer-events-none absolute -top-7 left-1/2 z-20 -translate-x-1/2 whitespace-nowrap rounded bg-surface-2 px-2 py-0.5 text-2xs text-fg opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                  {day.date}: {hours.toFixed(1)}h
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex justify-between text-2xs text-muted">
          <span>{byDay[0]?.date.slice(5)}</span>
          <span>{byDay[byDay.length - 1]?.date.slice(5)}</span>
        </div>
      </div>

      {/* Daily cards with mini timelines */}
      <div className="space-y-3">
        <span className="stat-label">Daily Breakdown</span>
        {byDay.map((day) => {
          const daySessions = sessionsByDay.get(day.date) ?? [];
          return (
            <div key={day.date} className="card">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-mono text-xs text-fg">{day.date}</span>
                <div className="flex gap-3 text-2xs text-muted">
                  <span>{formatMinutes(day.minutes)}</span>
                  <span>{day.events} events</span>
                  <span>{daySessions.length} sessions</span>
                </div>
              </div>
              {/* Mini timeline */}
              <div className="relative h-6 w-full rounded bg-bg">
                {daySessions.map((s, i) => {
                  const startMin = minuteOfDay(s.start);
                  const endMin = Math.min(1440, startMin + s.durationSec / 60);
                  const left = (startMin / 1440) * 100;
                  const width = Math.max(0.3, ((endMin - startMin) / 1440) * 100);
                  return (
                    <div
                      key={i}
                      className="absolute top-1 h-4 rounded-sm"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: colorForLabel(s.systems[0] ?? 'Other'),
                        opacity: 0.8,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
