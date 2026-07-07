/**
 * FrictionHeatmap — context switches by hour of day
 * =================================================
 * A 24-cell strip where each cell's intensity reflects how many system switches
 * happened in that UTC hour. Switch spikes are the clearest visual proxy for
 * workflow friction, so this gives an at-a-glance "when does the advisor churn".
 */
'use client';

import { useMemo } from 'react';
import { classifySystem } from '@/lib/analyze';
import type { BrowserEvent } from '@/lib/types';

/** Count system switches per UTC hour from the chronological event stream. */
function switchesByHour(events: BrowserEvent[]): number[] {
  const byHour = new Array<number>(24).fill(0);
  const sorted = [...events].sort(
    (a, b) =>
      new Date(a.timestamp_utc).getTime() - new Date(b.timestamp_utc).getTime(),
  );
  let prevKey: string | null = null;
  for (const e of sorted) {
    const key = classifySystem(e).key;
    if (prevKey !== null && key !== prevKey) {
      byHour[new Date(e.timestamp_utc).getUTCHours()] += 1;
    }
    prevKey = key;
  }
  return byHour;
}

export default function FrictionHeatmap({ events }: { events: BrowserEvent[] }) {
  const { hours, max } = useMemo(() => {
    const hours = switchesByHour(events);
    return { hours, max: Math.max(1, ...hours) };
  }, [events]);

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <span className="stat-label">Context switches by hour (UTC)</span>
        <span className="text-2xs text-muted">peak {max}/hr</span>
      </div>
      <div className="flex gap-1">
        {hours.map((count, h) => {
          const intensity = count / max; // 0–1
          return (
            <div key={h} className="flex flex-1 flex-col items-center gap-1">
              <div
                title={`${String(h).padStart(2, '0')}:00 — ${count} switches`}
                className="h-10 w-full rounded-sm border border-border/50"
                style={{
                  backgroundColor:
                    count === 0 ? '#161b22' : `rgba(6, 182, 212, ${0.15 + intensity * 0.85})`,
                }}
              />
              {h % 3 === 0 && (
                <span className="font-mono text-[9px] text-muted">
                  {String(h).padStart(2, '0')}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
