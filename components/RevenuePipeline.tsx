/**
 * RevenuePipeline — Revenue Recovery summary card
 * ================================================
 * Displays aggregate metrics for the recovery pipeline:
 * - Total Declined Work Found
 * - Marked as Recovered (customer came back)
 * - Recovery Rate %
 * - Lost (30 days, not recovered)
 */
import type { OutreachRecord } from '@/lib/outreach';

const usd = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const pct = (num: number, denom: number) =>
  denom > 0 ? `${Math.round((num / denom) * 100)}%` : '—';

interface Props {
  outreach: (OutreachRecord & {
    recovery_status?: string;
    recovered_amount?: number;
  })[];
}

export default function RevenuePipeline({ outreach }: Props) {
  // Total declined dollars tracked in outreach
  const totalDollars = outreach.reduce((s, o) => s + (o.est_dollars ?? 0), 0);
  const totalItems = outreach.length;

  // Recovered items
  const recovered = outreach.filter((o) => o.recovery_status === 'recovered');
  const recoveredDollars = recovered.reduce(
    (s, o) => s + (o.recovered_amount ?? o.est_dollars ?? 0),
    0,
  );

  // Lost items
  const lost = outreach.filter((o) => o.recovery_status === 'lost');
  const lostDollars = lost.reduce((s, o) => s + (o.est_dollars ?? 0), 0);

  // Pending: not marked and < 30 days old
  const pending = outreach.filter(
    (o) => !o.recovery_status || o.recovery_status === 'pending',
  );

  return (
    <div className="card mb-5 border-l-2 border-l-cyan">
      <span className="stat-label">Revenue Recovery Pipeline</span>
      <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <div className="text-2xs text-muted">Total Declined Found</div>
          <div className="font-display text-lg font-bold text-fg">
            {usd(totalDollars)}
          </div>
          <div className="text-2xs text-muted">{totalItems} items</div>
        </div>
        <div>
          <div className="text-2xs text-muted">Marked Recovered</div>
          <div className="font-display text-lg font-bold text-ok">
            {usd(recoveredDollars)}
          </div>
          <div className="text-2xs text-muted">{recovered.length} items</div>
        </div>
        <div>
          <div className="text-2xs text-muted">Recovery Rate</div>
          <div className="font-display text-lg font-bold text-cyan">
            {pct(recoveredDollars, totalDollars)}
          </div>
          <div className="text-2xs text-muted">
            by dollar value
          </div>
        </div>
        <div>
          <div className="text-2xs text-muted">Lost</div>
          <div className="font-display text-lg font-bold text-danger">
            {usd(lostDollars)}
          </div>
          <div className="text-2xs text-muted">
            {lost.length} items · {pending.length} pending
          </div>
        </div>
      </div>
    </div>
  );
}
