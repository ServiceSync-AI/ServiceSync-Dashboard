/**
 * InsightCard — a friction pattern / recommendation tile
 * ======================================================
 * Renders one FrictionPattern (or any titled insight) with a severity-colored
 * left rail, a headline metric, and supporting detail. Used on the insights
 * page for the friction report and recommendations.
 */
import type { ReactNode } from 'react';

type Severity = 'high' | 'medium' | 'low';

const RAIL: Record<Severity, string> = {
  high: 'border-l-danger',
  medium: 'border-l-warn',
  low: 'border-l-cyan',
};

const BADGE: Record<Severity, string> = {
  high: 'bg-danger/15 text-danger',
  medium: 'bg-warn/15 text-warn',
  low: 'bg-cyan/15 text-cyan',
};

export default function InsightCard({
  title,
  detail,
  metric,
  severity = 'low',
  children,
}: {
  title: string;
  detail: ReactNode;
  metric?: string;
  severity?: Severity;
  children?: ReactNode;
}) {
  return (
    <div className={`card border-l-2 ${RAIL[severity]}`}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-sm font-semibold text-fg">{title}</h3>
        {metric && (
          <span className={`badge whitespace-nowrap font-mono ${BADGE[severity]}`}>
            {metric}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{detail}</p>
      {children}
    </div>
  );
}
