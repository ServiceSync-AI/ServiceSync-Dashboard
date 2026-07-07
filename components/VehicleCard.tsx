/**
 * VehicleCard — top-of-page vehicle + RO summary
 * ====================================
 * Shows the dealership name/logo, the vehicle (year make model), and the
 * repair-order number.
 */
import type { TrackerView } from '@/lib/tracker/types';
import { vehicleLabel } from '@/lib/tracker/vehicle';

interface VehicleCardProps {
  view: TrackerView;
}

export default function VehicleCard({ view }: VehicleCardProps) {
  const vehicle = vehicleLabel(view.vehicle.year, view.vehicle.make, view.vehicle.model);

  return (
    <header className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-center gap-3">
        {view.dealership.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary dealer host, no optimization needed
          <img
            src={view.dealership.logo_url}
            alt={view.dealership.name}
            className="h-8 w-auto"
          />
        ) : (
          <span className="text-sm font-semibold uppercase tracking-wide text-cyan">
            {view.dealership.name}
          </span>
        )}
      </div>

      <h1 className="mt-3 font-heading text-2xl font-bold text-ink">{vehicle}</h1>
      {view.ro_number && (
        <p className="mt-1 text-sm text-muted">RO #{view.ro_number}</p>
      )}
    </header>
  );
}
