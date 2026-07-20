'use client';

/**
 * ServiceHealth — Watchdog Service Status
 * ========================================
 * Shows Rewind/Ambient/Chrome service status as green/red dots
 * with last-seen time. Fetches from /api/intel/heartbeat.
 * Red/stale if lastSeen > 20 minutes ago.
 */
import { useEffect, useState } from 'react';

interface HeartbeatData {
  advisor_id: string;
  services: Record<string, string>;
  lastSeen: string;
  minutesAgo: number;
}

const SERVICE_LABELS: Record<string, string> = {
  rewind: 'Rewind',
  ambient: 'Ambient',
  chrome: 'Chrome',
};

const STALE_THRESHOLD_MINUTES = 20;

function formatAgo(minutes: number): string {
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 min ago';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hr ago';
  return `${hours} hrs ago`;
}

export default function ServiceHealth() {
  const [data, setData] = useState<HeartbeatData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/intel/heartbeat')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HeartbeatData[]>;
      })
      .then(setData)
      .catch((err) => setError(String(err.message)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card animate-pulse">
        <span className="stat-label">Service Health</span>
        <div className="mt-2 h-16 rounded bg-surface-2" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card border-l-2 border-l-warn">
        <span className="stat-label">Service Health</span>
        <p className="mt-2 text-xs text-muted">Unable to load: {error}</p>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="card">
        <span className="stat-label">Service Health</span>
        <p className="mt-2 text-xs text-muted">No heartbeat data received yet.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <span className="stat-label">Service Health</span>
        <span className="text-2xs text-muted">via watchdog</span>
      </div>

      <div className="mt-3 space-y-3">
        {data.map((hb) => {
          const isStale = hb.minutesAgo > STALE_THRESHOLD_MINUTES;

          return (
            <div key={hb.advisor_id}>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-2xs font-medium text-fg/70">{hb.advisor_id}</span>
                <span className={`text-2xs ${isStale ? 'text-danger' : 'text-muted'}`}>
                  {isStale ? '⚠ stale — ' : ''}last seen {formatAgo(hb.minutesAgo)}
                </span>
              </div>
              <div className="flex gap-4">
                {Object.entries(SERVICE_LABELS).map(([key, label]) => {
                  const status = hb.services[key];
                  const isRunning = status === 'running';
                  const dotColor = isStale
                    ? 'bg-danger'
                    : isRunning
                      ? 'bg-ok'
                      : 'bg-danger';
                  const textColor = isStale
                    ? 'text-danger'
                    : isRunning
                      ? 'text-ok'
                      : 'text-danger';

                  return (
                    <div key={key} className="flex items-center gap-1.5">
                      <span
                        className={`inline-block h-2.5 w-2.5 rounded-full ${dotColor}`}
                        aria-label={`${label}: ${status ?? 'unknown'}`}
                      />
                      <span className="text-xs text-fg/80">{label}:</span>
                      <span className={`text-xs font-medium ${textColor}`}>
                        {status ?? 'unknown'}
                      </span>
                    </div>
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
