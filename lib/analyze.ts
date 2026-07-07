/**
 * Analysis & aggregation — Pilot Intelligence Dashboard
 * =====================================================
 * Turns the raw browser-event stream into the derived shapes the UI shows:
 * per-system time breakdowns, continuous sessions, idle detection, context-
 * switch counts, friction patterns, and transcript keyword highlights.
 *
 * All functions are pure (events in, derived data out) so they can run in API
 * routes or be unit-tested without S3.
 */
import type {
  BrowserEvent,
  EventsSummary,
  ActivitySession,
  FrictionPattern,
} from './types';

/* ------------------------- system classification ------------------------- */

/** Canonical category keys — must match the `sys.*` colors in tailwind.config. */
export type SystemKey =
  | 'asrpro'
  | 'globalconnect'
  | 'prodemand'
  | 'dms'
  | 'other'
  | 'distraction';

export interface SystemMeta {
  key: SystemKey;
  label: string;
}

// Hosts we treat as non-work distractions (gaming/social/streaming).
const DISTRACTION_HINTS = [
  'youtube',
  'facebook',
  'instagram',
  'tiktok',
  'twitter',
  'x.com',
  'reddit',
  'netflix',
  'twitch',
  'espn',
  'amazon.com',
  'ebay',
  'steam',
];

/**
 * Map a raw event to a canonical system + label. Prefers the `system` field the
 * extension already tags; otherwise infers from the URL/title. Falls back to
 * "Other" and flags obvious distractions.
 */
export function classifySystem(event: BrowserEvent): SystemMeta {
  const explicit = (event.system ?? '').trim();
  const haystack = `${event.system ?? ''} ${event.url ?? ''} ${event.window_title ?? ''}`.toLowerCase();

  if (/asr\s?pro|asrpro/.test(haystack)) return { key: 'asrpro', label: 'ASR Pro' };
  if (/global\s?connect|globalconnect|gm global/.test(haystack))
    return { key: 'globalconnect', label: 'Global Connect' };
  if (/prodemand|pro demand|mitchell1|identifix/.test(haystack))
    return { key: 'prodemand', label: 'ProDemand' };
  if (/cdk|reynolds|dealertrack|tekion|xtime|dms/.test(haystack))
    return { key: 'dms', label: explicit || 'DMS' };

  if (DISTRACTION_HINTS.some((h) => haystack.includes(h)))
    return { key: 'distraction', label: explicit || 'Distraction' };

  // Known system name we don't have a dedicated bucket for — keep its label.
  if (explicit && explicit.toLowerCase() !== 'other')
    return { key: 'other', label: explicit };

  return { key: 'other', label: 'Other' };
}

/* ------------------------------ tuning knobs ----------------------------- */

// A gap longer than this between events ends a session and counts as idle.
const IDLE_GAP_SEC = 5 * 60;
// Rapid-switch window: 3+ distinct systems within this span is a friction flag.
const RAPID_WINDOW_SEC = 2 * 60;
const RAPID_MIN_SYSTEMS = 3;

/** Sort a copy of events ascending by timestamp. */
function chronological(events: BrowserEvent[]): BrowserEvent[] {
  return [...events].sort(
    (a, b) => new Date(a.timestamp_utc).getTime() - new Date(b.timestamp_utc).getTime(),
  );
}

/* ------------------------------- summary --------------------------------- */

/** Aggregate a window of events into headline stats + per-system breakdown. */
export function summarize(events: BrowserEvent[]): EventsSummary {
  const sorted = chronological(events);
  const appBreakdown: Record<string, number> = {};
  const byDayMap = new Map<string, { events: number; seconds: number }>();

  let activeSeconds = 0;
  let idleSeconds = 0;
  let switches = 0;
  let lastSystemKey: string | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    const meta = classifySystem(e);
    const dur = Math.max(0, e.duration_sec || 0);
    activeSeconds += dur;
    appBreakdown[meta.label] = (appBreakdown[meta.label] ?? 0) + dur / 60;

    const day = e.timestamp_utc.slice(0, 10);
    const bucket = byDayMap.get(day) ?? { events: 0, seconds: 0 };
    bucket.events += 1;
    bucket.seconds += dur;
    byDayMap.set(day, bucket);

    if (lastSystemKey !== null && meta.key !== lastSystemKey) switches += 1;
    lastSystemKey = meta.key;

    // Idle = wall-clock gap between this event's end and the next event's start.
    if (i < sorted.length - 1) {
      const gap =
        (new Date(sorted[i + 1].timestamp_utc).getTime() -
          new Date(e.timestamp_utc).getTime()) /
          1000 -
        dur;
      if (gap > IDLE_GAP_SEC) idleSeconds += gap;
    }
  }

  const spanHours =
    sorted.length > 1
      ? (new Date(sorted[sorted.length - 1].timestamp_utc).getTime() -
          new Date(sorted[0].timestamp_utc).getTime()) /
        3_600_000
      : 0;

  const byDay = [...byDayMap.entries()]
    .map(([date, v]) => ({ date, events: v.events, minutes: Math.round(v.seconds / 60) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalEvents: sorted.length,
    totalHours: +(activeSeconds / 3600).toFixed(2),
    idleMinutes: Math.round(idleSeconds / 60),
    avgSwitchesPerHour: spanHours > 0 ? +(switches / spanHours).toFixed(1) : 0,
    appBreakdown,
    byDay,
    rangeStart: sorted.length ? sorted[0].timestamp_utc : null,
    rangeEnd: sorted.length ? sorted[sorted.length - 1].timestamp_utc : null,
  };
}

/* ------------------------------- sessions -------------------------------- */

/**
 * Split the event stream into continuous sessions, breaking on idle gaps.
 * Each session reports the systems touched, switch count, and whether it
 * contains a rapid-switch friction burst.
 */
export function buildSessions(events: BrowserEvent[]): ActivitySession[] {
  const sorted = chronological(events);
  const sessions: ActivitySession[] = [];
  let group: BrowserEvent[] = [];

  const flush = () => {
    if (!group.length) return;
    sessions.push(sessionFromGroup(group));
    group = [];
  };

  for (let i = 0; i < sorted.length; i++) {
    group.push(sorted[i]);
    if (i < sorted.length - 1) {
      const gap =
        (new Date(sorted[i + 1].timestamp_utc).getTime() -
          new Date(sorted[i].timestamp_utc).getTime()) /
        1000;
      if (gap > IDLE_GAP_SEC) flush();
    }
  }
  flush();
  return sessions;
}

function sessionFromGroup(group: BrowserEvent[]): ActivitySession {
  const start = group[0].timestamp_utc;
  const last = group[group.length - 1];
  const end = new Date(
    new Date(last.timestamp_utc).getTime() + (last.duration_sec || 0) * 1000,
  ).toISOString();

  const systemsSeen: string[] = [];
  let switches = 0;
  let prevKey: string | null = null;

  for (const e of group) {
    const meta = classifySystem(e);
    if (!systemsSeen.includes(meta.label)) systemsSeen.push(meta.label);
    if (prevKey !== null && meta.key !== prevKey) switches += 1;
    prevKey = meta.key;
  }

  return {
    start,
    end,
    durationSec: (new Date(end).getTime() - new Date(start).getTime()) / 1000,
    systems: systemsSeen,
    eventCount: group.length,
    switches,
    rapidSwitch: hasRapidSwitch(group),
  };
}

/** True if any RAPID_WINDOW_SEC window contains RAPID_MIN_SYSTEMS+ systems. */
function hasRapidSwitch(group: BrowserEvent[]): boolean {
  for (let i = 0; i < group.length; i++) {
    const windowStart = new Date(group[i].timestamp_utc).getTime();
    const seen = new Set<string>();
    for (let j = i; j < group.length; j++) {
      const t = new Date(group[j].timestamp_utc).getTime();
      if (t - windowStart > RAPID_WINDOW_SEC * 1000) break;
      seen.add(classifySystem(group[j]).key);
      if (seen.size >= RAPID_MIN_SYSTEMS) return true;
    }
  }
  return false;
}

/* ------------------------------- friction -------------------------------- */

/**
 * Surface the top friction patterns from a window of events. Heuristic, but
 * grounded in the real signals: cross-tool churn, distraction time, and idle.
 */
export function detectFriction(events: BrowserEvent[]): FrictionPattern[] {
  const summary = summarize(events);
  const sessions = buildSessions(events);
  const patterns: FrictionPattern[] = [];

  // 1. Rapid-switch bursts (the headline friction signal).
  const rapidSessions = sessions.filter((s) => s.rapidSwitch).length;
  if (rapidSessions > 0) {
    patterns.push({
      title: 'Rapid tool-switching bursts',
      detail: `${rapidSessions} session(s) where the advisor cycled through 3+ systems in under 2 minutes — a hallmark of hunting for information across disconnected tools.`,
      metric: `${rapidSessions} bursts`,
      severity: rapidSessions >= 3 ? 'high' : 'medium',
    });
  }

  // 2. ProDemand lookups interrupting work (switch-away signal).
  const prodemandMin = summary.appBreakdown['ProDemand'] ?? 0;
  if (prodemandMin > 0) {
    patterns.push({
      title: 'ProDemand lookups mid-RO',
      detail: `${Math.round(prodemandMin)} min spent in ProDemand. Repair-info lookups pull the advisor out of the DMS flow and back, adding handle time to each RO.`,
      metric: `${Math.round(prodemandMin)} min`,
      severity: prodemandMin > 30 ? 'medium' : 'low',
    });
  }

  // 3. High context-switch rate.
  if (summary.avgSwitchesPerHour >= 12) {
    patterns.push({
      title: 'High context-switch rate',
      detail: `Averaging ${summary.avgSwitchesPerHour} system switches per hour. Each switch carries a re-orientation cost; sustained high rates indicate fragmented workflows.`,
      metric: `${summary.avgSwitchesPerHour}/hr`,
      severity: summary.avgSwitchesPerHour >= 20 ? 'high' : 'medium',
    });
  }

  // 4. Distraction time.
  const distractionMin = summary.appBreakdown['Distraction'] ?? 0;
  if (distractionMin >= 5) {
    patterns.push({
      title: 'Time on non-work sites',
      detail: `${Math.round(distractionMin)} min on social / streaming / shopping sites during the window.`,
      metric: `${Math.round(distractionMin)} min`,
      severity: distractionMin > 30 ? 'high' : 'low',
    });
  }

  // 5. Idle time.
  if (summary.idleMinutes >= 15) {
    patterns.push({
      title: 'Idle / away-from-desk gaps',
      detail: `${summary.idleMinutes} min with no captured activity — advisor away from the desk or on the phone away from the tracked browser.`,
      metric: `${summary.idleMinutes} min`,
      severity: 'low',
    });
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  return patterns.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 5);
}

/* -------------------------- transcript highlights ------------------------ */

/** Keyword groups we scan transcripts for, with display intent. */
export const HIGHLIGHT_KEYWORDS: { label: string; terms: string[]; tone: 'warn' | 'danger' | 'info' }[] = [
  { label: 'Customer complaint', terms: ['complaint', 'unhappy', 'frustrated', 'angry', 'upset', 'ridiculous'], tone: 'danger' },
  { label: 'Hold / wait time', terms: ['on hold', 'still waiting', 'how long', 'taking forever', 'been waiting'], tone: 'warn' },
  { label: 'Declined work', terms: ['declined', 'decline', 'not today', 'maybe later', "can't afford", 'too expensive'], tone: 'warn' },
  { label: 'Advisor frustration', terms: ['stupid', 'broken', 'again', "doesn't work", 'come on', 'ugh'], tone: 'warn' },
  { label: 'Upsell / recommendation', terms: ['recommend', 'we found', 'also noticed', 'should replace', 'due for'], tone: 'info' },
];

export interface TranscriptHighlight {
  label: string;
  tone: 'warn' | 'danger' | 'info';
  count: number;
  examples: string[];
}

/**
 * Scan transcript text for the keyword groups above and return per-group hit
 * counts plus a couple of example snippets.
 */
export function transcriptHighlights(texts: string[]): TranscriptHighlight[] {
  const joined = texts.map((t) => t.toLowerCase());
  return HIGHLIGHT_KEYWORDS.map((group) => {
    let count = 0;
    const examples: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      for (const term of group.terms) {
        let idx = joined[i].indexOf(term);
        while (idx !== -1) {
          count += 1;
          if (examples.length < 3) {
            const snippet = texts[i].slice(Math.max(0, idx - 30), idx + term.length + 30).trim();
            examples.push(`…${snippet}…`);
          }
          idx = joined[i].indexOf(term, idx + term.length);
        }
      }
    }
    return { label: group.label, tone: group.tone, count, examples };
  }).filter((h) => h.count > 0);
}
