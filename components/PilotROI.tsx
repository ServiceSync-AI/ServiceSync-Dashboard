'use client';

/**
 * PilotROI — Cost-per-Insight ROI card (client component)
 * =======================================================
 * Fetches /api/intel/roi and renders the pilot ROI metrics: total AWS spend,
 * insight counts, cost per insight, value generated, and ROI ratio.
 *
 * Uses a simple fetch-on-mount pattern with a configurable days selector.
 */
import { useEffect, useState } from 'react';

interface ROIData {
  totalSpend: number;
  insights: {
    recoveryItems: number;
    auditReports: number;
    assistantQueries: number;
    total: number;
  };
  costPerInsight: number;
  valueFound: number;
  roiRatio: number;
  period: { start: string; end: string; days: number };
}

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });

const int = (n: number) => n.toLocaleString('en-US');

const PERIOD_OPTIONS = [7, 14, 30, 60] as const;

export default function PilotROI() {
  const [days, setDays] = useState<number>(7);
  const [data, setData] = useState<ROIData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/intel/roi?days=${days}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.detail || body.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((json: ROIData) => {
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err.message ?? err));
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [days]);

  // Loading state
  if (loading && !data) {
    return (
      <div className="card mb-5 border-l-2 border-l-violet animate-pulse">
        <span className="stat-label text-violet">Pilot ROI</span>
        <p className="mt-2 text-sm text-muted">Loading ROI data…</p>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="card mb-5 border-l-2 border-l-danger">
        <span className="stat-label text-danger">Pilot ROI — unavailable</span>
        <p className="mt-2 text-sm text-fg/90">
          ROI calculation couldn&apos;t run. The dashboard may need additional IAM permissions
          for Cost Explorer, DynamoDB, or S3.
        </p>
        <p className="mt-2 font-mono text-2xs text-muted">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const roiLabel =
    data.roiRatio >= 1
      ? `${Math.round(data.roiRatio)}x ROI`
      : data.roiRatio > 0
        ? `${data.roiRatio.toFixed(1)}x ROI`
        : '—';

  return (
    <div className="card mb-5 border-l-2 border-l-violet">
      {/* Header + period selector */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="stat-label text-violet">Pilot ROI</span>
        <div className="flex items-center gap-1">
          {PERIOD_OPTIONS.map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`rounded px-2 py-0.5 text-2xs font-medium transition-colors ${
                days === d
                  ? 'bg-violet/20 text-violet'
                  : 'text-muted hover:text-fg hover:bg-surface-2'
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {/* Hero ROI ratio */}
      <div className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1">
        <span className="font-display text-4xl font-bold text-violet">{roiLabel}</span>
        <span className="text-2xs text-muted">
          {data.period.start} → {data.period.end} · {data.period.days} days
        </span>
      </div>

      {/* Metrics grid */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {/* Total Spend */}
        <div>
          <p className="text-2xs text-muted uppercase tracking-wide">AWS Spend</p>
          <p className="mt-0.5 font-display text-lg font-bold text-cyan">
            {usd(data.totalSpend)}
          </p>
        </div>

        {/* Total Insights */}
        <div>
          <p className="text-2xs text-muted uppercase tracking-wide">Total Insights</p>
          <p className="mt-0.5 font-display text-lg font-bold text-fg">
            {int(data.insights.total)}
          </p>
        </div>

        {/* Cost per Insight */}
        <div>
          <p className="text-2xs text-muted uppercase tracking-wide">Cost / Insight</p>
          <p className="mt-0.5 font-display text-lg font-bold text-cyan">
            {data.costPerInsight > 0 ? usd(data.costPerInsight) : '—'}
          </p>
        </div>

        {/* Value Found */}
        <div>
          <p className="text-2xs text-muted uppercase tracking-wide">Value Found</p>
          <p className="mt-0.5 font-display text-lg font-bold text-green">
            {data.valueFound > 0 ? usd(data.valueFound) : '—'}
          </p>
        </div>

        {/* ROI Ratio */}
        <div>
          <p className="text-2xs text-muted uppercase tracking-wide">ROI Ratio</p>
          <p className="mt-0.5 font-display text-lg font-bold text-violet">{roiLabel}</p>
        </div>
      </div>

      {/* Insight breakdown */}
      <div className="mt-4 overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Insight Source</th>
              <th className="text-right">Count</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="text-fg">Declined work items found</td>
              <td className="text-right text-green">{int(data.insights.recoveryItems)}</td>
            </tr>
            <tr>
              <td className="text-fg">Audit reports generated</td>
              <td className="text-right text-cyan">{int(data.insights.auditReports)}</td>
            </tr>
            <tr>
              <td className="text-fg">Assistant answers delivered</td>
              <td className="text-right text-magenta">{int(data.insights.assistantQueries)}</td>
            </tr>
            <tr className="border-t border-border">
              <td className="font-medium text-fg">Total insights</td>
              <td className="text-right font-bold text-fg">{int(data.insights.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {loading && (
        <p className="mt-2 text-2xs text-muted animate-pulse">Refreshing…</p>
      )}
    </div>
  );
}
