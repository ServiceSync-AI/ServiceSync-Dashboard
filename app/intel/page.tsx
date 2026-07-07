/**
 * Overview (/) — pilot mission control
 * ====================================
 * Server-rendered at request time: pulls system health + storage/activity
 * stats straight from S3 (and a TCP reachability ping) and lays them out as a
 * grid of status cards with a recent-activity feed below. Refresh is explicit
 * via the header button (router.refresh re-runs this fetch).
 */
import { listAll } from '@/lib/s3';
import { config } from '@/lib/config';
import { pcReachable } from '@/lib/ssh';
import { loadEventsForDay, latestEventTimestamp } from '@/lib/events';
import { todayUTC, relativeTime, absoluteTime, formatBytes, clockUTC } from '@/lib/format';
import { classifySystem } from '@/lib/analyze';
import StatusCard from '@/components/StatusCard';
import RefreshButton from '@/components/RefreshButton';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Audio chunks are 30 minutes each — used to estimate recorded hours.
const CHUNK_MINUTES = 30;
const AUDIO_FRESH_MS = 90 * 60 * 1000;
const EVENT_FRESH_MS = 30 * 60 * 1000;

async function gather() {
  const today = todayUTC();
  const [reachable, audioObjs, transcriptObjs, eventObjs, lastEvent, todayEvents] =
    await Promise.all([
      pcReachable(),
      listAll(config.audioBucket, config.audioPrefix),
      listAll(config.audioBucket, config.transcriptsPrefix),
      listAll(config.eventsBucket, config.eventsPrefix),
      latestEventTimestamp(),
      loadEventsForDay(today),
    ]);

  const mp3s = audioObjs.filter((o) => o.Key && /\.mp3$/i.test(o.Key));
  const transcripts = transcriptObjs.filter((o) => o.Key && /\.json$/i.test(o.Key));

  const totalBytes = mp3s.reduce((sum, o) => sum + (o.Size ?? 0), 0);
  const filesToday = mp3s.filter(
    (o) => (o.LastModified ?? new Date(0)).toISOString().slice(0, 10) === today,
  ).length;
  const newestAudio = mp3s.reduce<Date | null>(
    (acc, o) => (!acc || (o.LastModified && o.LastModified > acc) ? o.LastModified ?? acc : acc),
    null,
  );

  // Days of data = span from earliest audio file to now.
  const earliest = mp3s.reduce<Date | null>(
    (acc, o) =>
      !acc || (o.LastModified && o.LastModified < acc) ? o.LastModified ?? acc : acc,
    null,
  );
  const daysOfData = earliest
    ? Math.max(1, Math.ceil((Date.now() - earliest.getTime()) / 86_400_000))
    : 0;

  const now = Date.now();
  return {
    reachable,
    audioCount: mp3s.length,
    totalBytes,
    filesToday,
    recordedHours: (mp3s.length * CHUNK_MINUTES) / 60,
    transcriptCount: transcripts.length,
    eventFileCount: eventObjs.length,
    eventsToday: todayEvents.length,
    lastEvent,
    newestAudio: newestAudio ? newestAudio.toISOString() : null,
    audioCapturing: newestAudio ? now - newestAudio.getTime() < AUDIO_FRESH_MS : false,
    extensionActive: lastEvent ? now - new Date(lastEvent).getTime() < EVENT_FRESH_MS : false,
    daysOfData,
    todayEvents,
  };
}

export default async function OverviewPage() {
  const d = await gather();
  const loadedAt = clockUTC(new Date().toISOString());

  // Recent activity feed: latest events, newest first.
  const feed = [...d.todayEvents].reverse().slice(0, 12);

  return (
    <div className="px-6 py-5">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">Overview</h1>
          <p className="text-2xs text-muted">
            Chevyland Chevrolet · advisor {config.advisorId}
          </p>
        </div>
        <RefreshButton generatedAt={`${loadedAt} UTC`} />
      </header>

      {/* Health row */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatusCard
          label="Dealer PC"
          value={d.reachable ? 'Online' : 'Offline'}
          tone={d.reachable ? 'ok' : 'danger'}
          sub={`Tailscale ${config.pc.ip}`}
        />
        <StatusCard
          label="Audio Capture"
          value={d.audioCapturing ? 'Running' : 'Stale'}
          tone={d.audioCapturing ? 'ok' : 'warn'}
          sub={`last upload ${relativeTime(d.newestAudio)}`}
          title={absoluteTime(d.newestAudio)}
        />
        <StatusCard
          label="Extension"
          value={d.extensionActive ? 'Active' : 'Idle'}
          tone={d.extensionActive ? 'ok' : 'warn'}
          sub={`last event ${relativeTime(d.lastEvent)}`}
          title={absoluteTime(d.lastEvent)}
        />
        <StatusCard
          label="Days of Data"
          value={d.daysOfData}
          tone="info"
          sub="since first capture"
        />
      </div>

      {/* Storage / volume row */}
      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatusCard
          label="Audio Files"
          value={d.audioCount.toLocaleString()}
          sub={`${d.filesToday} today · ${formatBytes(d.totalBytes)}`}
        />
        <StatusCard
          label="Hours Recorded"
          value={`~${d.recordedHours.toFixed(1)}`}
          sub={`${d.transcriptCount} transcribed`}
        />
        <StatusCard
          label="Events Today"
          value={d.eventsToday.toLocaleString()}
          sub={`${d.eventFileCount} event files in S3`}
        />
        <StatusCard
          label="Transcripts"
          value={d.transcriptCount.toLocaleString()}
          sub={`of ${d.audioCount} recordings`}
        />
      </div>

      {/* Recent activity feed */}
      <section className="mt-6">
        <h2 className="stat-label mb-2">Recent activity</h2>
        <div className="card overflow-hidden p-0">
          {feed.length === 0 ? (
            <p className="p-4 text-xs text-muted">No events captured today yet.</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>System</th>
                  <th>Action</th>
                  <th>Window / URL</th>
                </tr>
              </thead>
              <tbody>
                {feed.map((e) => {
                  const sys = classifySystem(e);
                  return (
                    <tr key={e.event_id}>
                      <td className="text-muted">{clockUTC(e.timestamp_utc)}</td>
                      <td className="text-cyan">{sys.label}</td>
                      <td className="text-fg/80">
                        {e.element_label || e.interaction_type || e.task_type || '—'}
                      </td>
                      <td className="max-w-md truncate text-muted">
                        {e.window_title || e.url || '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
