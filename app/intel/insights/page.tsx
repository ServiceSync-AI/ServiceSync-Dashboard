/**
 * Insights (/insights) — AI-style analysis of the captured data
 * =============================================================
 * Server-rendered synthesis over the last week of activity plus recent
 * transcripts: a daily summary line, the top friction patterns, transcript
 * keyword highlights (complaints / hold time / declined work), heuristic
 * recommendations, and a clean "audit preview" block suitable for showing a
 * dealer principal.
 *
 * Heuristics are clearly labeled — this is decision support for the founder,
 * not a model verdict. Cost is bounded: events for a fixed window, and only the
 * most recent N transcripts are scanned.
 */
import { listAll, getObjectText } from '@/lib/s3';
import { config } from '@/lib/config';
import { loadEventsInRange, loadEventsForDay } from '@/lib/events';
import { parseTranscript } from '@/lib/transcribe';
import {
  summarize,
  detectFriction,
  transcriptHighlights,
} from '@/lib/analyze';
import { todayUTC, formatMinutes, clockUTC } from '@/lib/format';
import InsightCard from '@/components/InsightCard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WINDOW_DAYS = 7;
// Cap transcript scanning so the page stays responsive.
const MAX_TRANSCRIPTS = 15;

const TONE_BADGE: Record<'warn' | 'danger' | 'info', string> = {
  danger: 'bg-danger/15 text-danger',
  warn: 'bg-warn/15 text-warn',
  info: 'bg-cyan/15 text-cyan',
};

async function gather() {
  const today = todayUTC();
  const end = new Date();
  const start = new Date(end.getTime() - WINDOW_DAYS * 86_400_000);

  // TODO(multi-advisor): read the ss_advisor cookie and scope events +
  // transcripts to the selected advisor (see lib/advisors.ts / recovery wiring).
  const [weekEvents, todayEvents, transcriptObjs] = await Promise.all([
    loadEventsInRange(start.toISOString(), end.toISOString()),
    loadEventsForDay(today),
    listAll(config.audioBucket, config.transcriptsPrefix),
  ]);

  // Pull the most recent transcripts for keyword scanning.
  const recent = transcriptObjs
    .filter((o) => o.Key && /\.json$/i.test(o.Key))
    .sort((a, b) => (b.LastModified ?? new Date(0)).getTime() - (a.LastModified ?? new Date(0)).getTime())
    .slice(0, MAX_TRANSCRIPTS);

  const transcriptTexts: string[] = [];
  await Promise.all(
    recent.map(async (o) => {
      try {
        const raw = await getObjectText(config.audioBucket, o.Key!);
        transcriptTexts.push(parseTranscript(raw, o.Key!).text);
      } catch {
        /* skip unreadable transcript */
      }
    }),
  );

  return {
    weekSummary: summarize(weekEvents),
    todaySummary: summarize(todayEvents),
    friction: detectFriction(weekEvents),
    highlights: transcriptHighlights(transcriptTexts),
    transcriptsScanned: transcriptTexts.length,
  };
}

/** Build heuristic recommendations from the aggregated numbers. */
function recommendations(week: ReturnType<typeof summarize>): string[] {
  const recs: string[] = [];
  const days = Math.max(1, week.byDay.length);
  const distractionPerDay = (week.appBreakdown['Distraction'] ?? 0) / days;
  const prodemand = week.appBreakdown['ProDemand'] ?? 0;

  if (distractionPerDay >= 10) {
    recs.push(
      `Advisor averages ~${Math.round(distractionPerDay)} min/day on non-work sites. Worth a conversation, and a baseline to measure against post-rollout.`,
    );
  }
  if (week.avgSwitchesPerHour >= 12) {
    recs.push(
      `${week.avgSwitchesPerHour} system switches/hr suggests information is scattered across tools. This is exactly the friction Declined Work Recovery removes by surfacing context in one place.`,
    );
  }
  if (prodemand > 0) {
    recs.push(
      `${Math.round(prodemand)} min in ProDemand this week confirms repair-info lookups interrupt the RO flow — a strong pilot story for embedded recommendations.`,
    );
  }
  if (week.idleMinutes / days >= 60) {
    recs.push(
      `~${formatMinutes(week.idleMinutes / days)}/day idle at the tracked browser — likely phone/desk time. Pair with audio transcripts to see what's happening during those gaps.`,
    );
  }
  if (recs.length === 0) {
    recs.push('Not enough signal yet — keep capturing. Recommendations sharpen as the dataset grows.');
  }
  return recs;
}

export default async function InsightsPage() {
  const d = await gather();
  const t = d.todaySummary;
  const w = d.weekSummary;
  const recs = recommendations(w);
  const generatedAt = clockUTC(new Date().toISOString());

  return (
    <div className="px-6 py-5">
      <header className="mb-5">
        <h1 className="font-display text-xl font-bold tracking-tight">Insights</h1>
        <p className="text-2xs text-muted">
          Heuristic analysis · last {WINDOW_DAYS} days · {d.transcriptsScanned} transcripts scanned
        </p>
      </header>

      {/* Daily summary */}
      <div className="card mb-4 border-l-2 border-l-cyan">
        <span className="stat-label">Today — {todayUTC()}</span>
        <p className="mt-2 text-sm leading-relaxed text-fg/90">
          <span className="font-mono text-cyan">{formatMinutes(t.totalHours * 60)}</span>{' '}
          active, <span className="font-mono text-warn">{formatMinutes(t.idleMinutes)}</span>{' '}
          idle across{' '}
          <span className="font-mono text-fg">{t.totalEvents.toLocaleString()}</span>{' '}
          tracked events, averaging{' '}
          <span className="font-mono text-fg">{t.avgSwitchesPerHour}</span> system
          switches/hr. Most time in{' '}
          <span className="text-cyan">
            {Object.entries(t.appBreakdown).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'}
          </span>
          .
        </p>
      </div>

      {/* Friction report */}
      <section className="mb-6">
        <h2 className="stat-label mb-2">Top friction patterns</h2>
        {d.friction.length === 0 ? (
          <div className="card text-xs text-muted">
            No notable friction detected in the window.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {d.friction.map((f) => (
              <InsightCard
                key={f.title}
                title={f.title}
                detail={f.detail}
                metric={f.metric}
                severity={f.severity}
              />
            ))}
          </div>
        )}
      </section>

      {/* Audio highlights */}
      <section className="mb-6">
        <h2 className="stat-label mb-2">Audio highlights</h2>
        {d.highlights.length === 0 ? (
          <div className="card text-xs text-muted">
            No flagged phrases in the {d.transcriptsScanned} most recent transcripts
            {d.transcriptsScanned === 0 ? ' (none transcribed yet).' : '.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {d.highlights.map((h) => (
              <div key={h.label} className="card">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-fg">{h.label}</span>
                  <span className={`badge font-mono ${TONE_BADGE[h.tone]}`}>
                    {h.count}×
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {h.examples.map((ex, i) => (
                    <li key={i} className="text-2xs italic leading-relaxed text-muted">
                      {ex}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Recommendations */}
      <section className="mb-6">
        <h2 className="stat-label mb-2">Recommendations</h2>
        <div className="space-y-2">
          {recs.map((r, i) => (
            <div key={i} className="card flex gap-3 text-xs leading-relaxed text-fg/90">
              <span className="text-cyan">▸</span>
              <span>{r}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Audit preview */}
      <section>
        <h2 className="stat-label mb-2">Audit preview (dealer-ready)</h2>
        <div className="card bg-surface-2 font-mono text-xs leading-relaxed text-fg/90">
          <p className="mb-2 text-cyan">
            SERVICESYNC PILOT — OBSERVED WORKFLOW SUMMARY
          </p>
          <p className="text-muted">Advisor: {config.advisorId} · Window: last {WINDOW_DAYS} days</p>
          <hr className="my-2 border-border" />
          <p>• Active tracked time: {formatMinutes(w.totalHours * 60)}</p>
          <p>• Idle / away-from-desk: {formatMinutes(w.idleMinutes)}</p>
          <p>• Avg context switches: {w.avgSwitchesPerHour}/hr</p>
          <p>
            • Time in repair-info tools (ProDemand):{' '}
            {formatMinutes(w.appBreakdown['ProDemand'] ?? 0)}
          </p>
          <p>
            • Non-work site time:{' '}
            {formatMinutes(w.appBreakdown['Distraction'] ?? 0)}
          </p>
          <p>• Detected friction patterns: {d.friction.length}</p>
          <p>• Transcripts analyzed: {d.transcriptsScanned}</p>
          <hr className="my-2 border-border" />
          <p className="text-muted">
            Generated {generatedAt} UTC · figures are observed, not estimated.
          </p>
        </div>
      </section>
    </div>
  );
}
