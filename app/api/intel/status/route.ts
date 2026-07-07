/**
 * GET /api/status — pilot system health at a glance
 * =================================================
 * Combines a cheap TCP reachability check on the dealership PC (Tailscale) with
 * S3 freshness signals: newest audio upload and newest browser event. We infer
 * "capturing" / "extension active" from recency rather than SSHing (the /live
 * page does the heavier live probes).
 *
 * Returns: SystemStatus
 */
import { NextResponse } from 'next/server';
import { listAll } from '@/lib/s3';
import { config } from '@/lib/config';
import { pcReachable } from '@/lib/ssh';
import { latestEventTimestamp } from '@/lib/events';
import type { SystemStatus } from '@/lib/types';

export const runtime = 'nodejs';
// Live health check — never prerender; short CDN cache via the header below.
export const dynamic = 'force-dynamic';

// Audio uploads hourly (30-min chunks) — stale if older than 90 min.
const AUDIO_FRESH_MS = 90 * 60 * 1000;
// Events flush frequently — extension considered active if seen in last 30 min.
const EVENT_FRESH_MS = 30 * 60 * 1000;

export async function GET() {
  try {
    const [reachable, audioObjs, lastEvent] = await Promise.all([
      pcReachable(),
      listAll(config.audioBucket, config.audioPrefix),
      latestEventTimestamp(),
    ]);

    const newestAudio = audioObjs
      .filter((o) => o.Key && /\.mp3$/i.test(o.Key))
      .reduce<Date | null>((acc, o) => {
        const lm = o.LastModified ?? null;
        return !acc || (lm && lm > acc) ? lm : acc;
      }, null);

    const now = Date.now();
    const lastAudioUpload = newestAudio ? newestAudio.toISOString() : null;
    const audioCapturing = newestAudio
      ? now - newestAudio.getTime() < AUDIO_FRESH_MS
      : false;
    const extensionActive = lastEvent
      ? now - new Date(lastEvent).getTime() < EVENT_FRESH_MS
      : false;

    const status: SystemStatus = {
      pcOnline: reachable,
      lastAudioUpload,
      lastEvent,
      audioCapturing,
      extensionActive,
      checkedAt: new Date().toISOString(),
    };
    return NextResponse.json(status, {
      headers: { 'Cache-Control': 's-maxage=30' },
    });
  } catch (err) {
    return NextResponse.json(
      { error: 'status check failed', detail: String((err as Error).message) },
      { status: 500 },
    );
  }
}
