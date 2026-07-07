/**
 * Browser Activity (/activity) — timeline, breakdown, sessions
 * ============================================================
 * Loads a day's browser events from /api/events and derives everything client-
 * side with the shared analyzer: a 24h session timeline, per-system time
 * breakdown, switches-by-hour heatmap, the session list, and flagged
 * rapid-switch "friction" moments.
 */
'use client';

import { useEffect, useMemo, useState } from 'react';
import ActivityTimeline from '@/components/ActivityTimeline';
import AppUsageChart from '@/components/AppUsageChart';
import FrictionHeatmap from '@/components/FrictionHeatmap';
import StatusCard from '@/components/StatusCard';
import { summarize, buildSessions } from '@/lib/analyze';
import { todayUTC, formatMinutes, formatDuration, clockUTC } from '@/lib/format';
import type { BrowserEvent } from '@/lib/types';

export default function ActivityPage() {
  const [date, setDate] = useState(todayUTC());
  const [events, setEvents] = useState<BrowserEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const res = await fetch(`/api/intel/events?date=${date}`);
        if (!res.ok) throw new Error(`events failed (${res.status})`);
        const data: BrowserEvent[] = await res.json();
        if (!cancelled) setEvents(data);
      } catch (e) {
        if (!cancelled) setError(String((e as Error).message));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  const summary = useMemo(() => summarize(events), [events]);
  const sessions = useMemo(() => buildSessions(events), [events]);
  const rapidSessions = useMemo(() => sessions.filter((s) => s.rapidSwitch), [sessions]);

  return (
    <div className="px-6 py-5">
      <header className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight">Browser Activity</h1>
          <p className="text-2xs text-muted">{events.length} events on {date}</p>
        </div>
        <input
          type="date"
          value={date}
          max={todayUTC()}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-border bg-surface px-2 py-1.5 font-mono text-xs text-fg outline-none focus:border-cyan"
        />
      </header>

      {error && <div className="card mb-4 text-xs text-danger">Error: {error}</div>}
      {loading && <div className="card text-xs text-muted">Loading events…</div>}

      {!loading && (
        <>
          {/* Headline stats */}
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

          <div className="space-y-4">
            <ActivityTimeline sessions={sessions} />

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className="card">
                <span className="stat-label mb-3 block">Time per system</span>
                <AppUsageChart breakdown={summary.appBreakdown} />
              </div>
              <FrictionHeatmap events={events} />
            </div>

            {/* Session list */}
            <div>
              <h2 className="stat-label mb-2">Sessions</h2>
              <div className="card overflow-hidden p-0">
                {sessions.length === 0 ? (
                  <p className="p-4 text-xs text-muted">No sessions for this day.</p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Start</th>
                        <th>Duration</th>
                        <th>Systems</th>
                        <th>Events</th>
                        <th>Switches</th>
                        <th>Flag</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sessions.map((s, i) => (
                        <tr key={i}>
                          <td className="text-muted">{clockUTC(s.start)}</td>
                          <td>{formatDuration(s.durationSec)}</td>
                          <td className="max-w-xs truncate text-cyan">
                            {s.systems.join(', ')}
                          </td>
                          <td>{s.eventCount}</td>
                          <td>{s.switches}</td>
                          <td>
                            {s.rapidSwitch ? (
                              <span className="badge bg-danger/15 text-danger">
                                rapid-switch
                              </span>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
