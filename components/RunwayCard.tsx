'use client';

/**
 * RunwayCard — AWS credits runway estimator
 * Shows remaining credits, monthly burn rate, and months until depletion.
 * Credits balance is manually set (AWS doesn't expose it via API).
 * Burn rate is calculated from Cost Explorer forecast.
 */
import { useEffect, useState } from 'react';

interface RunwayData {
  creditBalance: number;
  monthlyBurn: number;
  runway: number;
  expires: string;
}

export default function RunwayCard() {
  const [data, setData] = useState<RunwayData | null>(null);

  useEffect(() => {
    // Credits balance from manual config (update monthly)
    // AWS doesn't expose credit balance via API
    const CREDIT_BALANCE = 825; // Last checked Jul 2026
    const CREDIT_EXPIRES = 'Aug 31, 2027';

    // Fetch burn rate from our API
    fetch('/api/intel/roi')
      .then((r) => r.json())
      .then((roi) => {
        // Use totalSpend from ROI or fall back to estimated
        const monthlyBurn = roi?.totalSpend > 0
          ? roi.totalSpend * (30 / 7) // extrapolate weekly to monthly
          : 45; // fallback estimate

        const runway = Math.floor(CREDIT_BALANCE / monthlyBurn);
        setData({
          creditBalance: CREDIT_BALANCE,
          monthlyBurn: Math.round(monthlyBurn),
          runway,
          expires: CREDIT_EXPIRES,
        });
      })
      .catch(() => {
        // Fallback
        setData({
          creditBalance: CREDIT_BALANCE,
          monthlyBurn: 45,
          runway: Math.floor(CREDIT_BALANCE / 45),
          expires: CREDIT_EXPIRES,
        });
      });
  }, []);

  if (!data) return null;

  const pct = Math.max(0, Math.min(100, (data.creditBalance / 1000) * 100));
  const urgency = data.runway > 12 ? 'ok' : data.runway > 6 ? 'warn' : 'danger';
  const colors = { ok: 'text-[#34d399]', warn: 'text-[#fbbf24]', danger: 'text-[#f85149]' };

  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="stat-label">AWS Credits Runway</span>
        <span className="text-2xs text-muted">expires {data.expires}</span>
      </div>

      {/* Hero numbers */}
      <div className="mb-4 grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className={`font-display text-2xl font-bold ${colors[urgency]}`}>
            ${data.creditBalance}
          </div>
          <div className="text-2xs text-muted">remaining</div>
        </div>
        <div className="text-center">
          <div className="font-display text-2xl font-bold text-fg">
            ~${data.monthlyBurn}
          </div>
          <div className="text-2xs text-muted">/ month</div>
        </div>
        <div className="text-center">
          <div className={`font-display text-2xl font-bold ${colors[urgency]}`}>
            {data.runway}mo
          </div>
          <div className="text-2xs text-muted">runway</div>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full transition-all ${
            urgency === 'ok' ? 'bg-[#34d399]' : urgency === 'warn' ? 'bg-[#fbbf24]' : 'bg-[#f85149]'
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex justify-between text-2xs text-muted">
        <span>$0</span>
        <span>${data.creditBalance} of $1,000 original</span>
      </div>
    </div>
  );
}
