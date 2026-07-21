'use client';

/**
 * ServiceHealth — Advisor Station Health
 * ========================================
 * Shows per-service status (Rewind, Ambient, Upload, Chrome) as colored dots.
 * Green = running, Red = stopped, Amber = restarted.
 * Warns if last heartbeat > 20 minutes ago.
 */
import { useEffect, useState } from 'react';

interface HeartbeatData {
  advisor_id: string;
  services: { rewind: string; ambient: string; upload: string; chrome: string };
  lastSeen: string;
  minutesAgo: number;
}

const SERVICES: { key: keyof HeartbeatData['services']; label: string }[] = [
  { key: 'rewind', label: 'Rewind (Desktop Capture)' },
  { key: 'ambient', label: 'Ambient (Audio Recording)' },
  { key: 'upload', label: 'Upload (S3 Sync)' },
  { key: 'chrome', label: 'Chrome (Extension)' },
];

const STALE_MINUTES = 20;

function dotColor(status: string): string {
  if (status === 'running') return 'bg-[#34d399]';
  if (status === 'restarted') return 'bg-[#fbbf24]';
  return 'bg-[#f85149]'; // stopped or unknown
}

export default function ServiceHealth() {
  const [data, setData] = useState<HeartbeatData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/intel/heartbeat')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<HeartbeatData>;
      })
      .then(setData)
      .catch((err) => setError(String(err.message)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="card p-4 animate-pulse">
        <span className="stat-label">Advisor Station Health</span>
        <div className="mt-2 h-20 rounded bg-surface-2" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-4 border-l-2 border-l-warn">
        <span className="stat-label">Advisor Station Health</span>
        <p className="mt-2 text-xs text-muted">Unable to load: {error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="card p-4">
        <span className="stat-label">Advisor Station Health</span>
        <p className="mt-2 text-xs text-muted">No heartbeat data received yet.</p>
      </div>
    );
  }

  const isStale = data.minutesAgo > STALE_MINUTES;

  return (
    <div className="card p-4">
      <span className="stat-label">Advisor Station Health</span>

      <div className="mt-3 space-y-2">
        {SERVICES.map(({ key, label }) => {
          const status = data.services[key];
          return (
            <div key={key} className="flex items-center gap-2">
              <span
                className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotColor(status)}`}
                aria-label={`${label}: ${status}`}
              />
              <span className="text-xs text-fg/80">{label}</span>
              <span className="ml-auto text-xs font-medium text-muted">{status}</span>
            </div>
          );
        })}
      </div>

      <div className={`mt-3 text-2xs ${isStale ? 'text-danger font-medium' : 'text-muted'}`}>
        {isStale && '⚠ '}Last check: {data.minutesAgo} min ago
        {isStale && ' — heartbeat may be offline'}
      </div>
    </div>
  );
}
