/**
 * StatusCard — a single stat / health tile
 * =========================================
 * The building block of the overview + live grids: a label, a big mono value,
 * an optional status dot (ok/warn/danger/idle), and an optional sub-line.
 * Pure/presentational so it works in both server and client trees.
 */
import type { ReactNode } from 'react';

type Tone = 'ok' | 'warn' | 'danger' | 'idle' | 'info';

const DOT: Record<Tone, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  idle: 'bg-muted',
  info: 'bg-cyan',
};

export default function StatusCard({
  label,
  value,
  sub,
  tone,
  title,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <div className="card card-hover" title={title}>
      <div className="flex items-center justify-between">
        <span className="stat-label">{label}</span>
        {tone && <span className={`dot ${DOT[tone]}`} aria-hidden />}
      </div>
      <div className="stat-value mt-2 truncate">{value}</div>
      {sub && <div className="mt-1 text-2xs text-muted">{sub}</div>}
    </div>
  );
}
