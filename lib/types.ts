/**
 * Shared types — Pilot Intelligence Dashboard
 * ===========================================
 * The data contracts shared between API route handlers, lib helpers, and the
 * client components. Mirrors the on-disk shapes (S3 listings, the browser-event
 * JSONL schema, AWS Transcribe output) plus the aggregated shapes we compute.
 */

/** One MP3 in the audio bucket, annotated with whether a transcript exists. */
export interface AudioFile {
  key: string;
  name: string;
  size: number;
  lastModified: string; // ISO
  hasTranscript: boolean;
  transcriptKey?: string;
}

/** A transcript listing entry (metadata only — body fetched separately). */
export interface TranscriptListEntry {
  key: string;
  id: string; // url-safe identifier derived from the key
  audioFile: string;
  lastModified: string; // ISO
  size: number;
}

/** A timestamped chunk of a transcript. */
export interface TranscriptSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

/** A fully parsed transcript. */
export interface Transcript {
  id: string;
  text: string;
  segments: TranscriptSegment[];
  durationSec: number;
  wordCount: number;
}

/**
 * One browser-activity event. Mirrors the JSONL schema produced by the Chrome
 * extension → Lambda → S3 pipeline. Optional fields tolerate older events that
 * predate a given field.
 */
export interface BrowserEvent {
  event_id: string;
  advisor_id: string;
  timestamp_utc: string; // ISO
  duration_sec: number;
  url?: string;
  window_title?: string;
  task_type?: string;
  system?: string;
  interaction_type?: string;
  element_label?: string;
  source?: string;
}

/** Aggregated stats over a window of browser events. */
export interface EventsSummary {
  totalEvents: number;
  totalHours: number;
  idleMinutes: number;
  avgSwitchesPerHour: number;
  appBreakdown: Record<string, number>; // system -> minutes
  byDay: { date: string; events: number; minutes: number }[];
  rangeStart: string | null;
  rangeEnd: string | null;
}

/** A continuous usage session derived from the event stream. */
export interface ActivitySession {
  start: string; // ISO
  end: string; // ISO
  durationSec: number;
  systems: string[];
  eventCount: number;
  switches: number;
  /** True when the advisor rapid-switched 3+ systems in <2 min (friction). */
  rapidSwitch: boolean;
}

/** A detected friction pattern for the insights page. */
export interface FrictionPattern {
  title: string;
  detail: string;
  metric: string;
  severity: 'high' | 'medium' | 'low';
}

export interface SystemStatus {
  pcOnline: boolean;
  lastAudioUpload: string | null;
  lastEvent: string | null;
  audioCapturing: boolean;
  extensionActive: boolean;
  checkedAt: string;
}
