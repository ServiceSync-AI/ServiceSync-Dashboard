'use client';
import { useEffect, useState } from 'react';

interface HeartbeatData {
  services: Record<string, string> | null;
  lastSeen?: string;
  minutesAgo: number;
}

const SERVICE_LABELS: Record<string, string> = {
  rewind: 'Desktop Capture',
  ambient: 'Audio Recording',
  upload: 'S3 Sync',
  chrome: 'Extension',
};

export default function ServiceHealth() {
  const [data, setData] = useState<HeartbeatData | null>(null);

  useEffect(() => {
    fetch('/api/intel/heartbeat')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  if (!data || !data.services) return null;

  const stale = data.minutesAgo > 20;

  return (
    <div className="card p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="stat-label">Advisor Station Health</span>
        <span className={`text-2xs ${stale ? 'text-[#f85149]' : 'text-muted'}`}>
          {stale ? '⚠ Stale' : `${data.minutesAgo}m ago`}
        </span>
      </div>
      <div className="space-y-2">
        {Object.entries(data.services).map(([key, status]) => (
          <div key={key} className="flex items-center gap-2.5">
            <span
              className={`h-2 w-2 rounded-full ${
                status === 'running' ? 'bg-[#34d399]' :
                status === 'restarted' ? 'bg-[#fbbf24]' :
                'bg-[#f85149]'
              }`}
            />
            <span className="text-xs text-fg">{SERVICE_LABELS[key] || key}</span>
            <span className="ml-auto text-2xs text-muted">{status}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
