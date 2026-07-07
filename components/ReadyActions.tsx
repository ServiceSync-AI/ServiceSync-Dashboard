/**
 * ReadyActions — call-to-action shown when the vehicle is ready
 * ====================================
 * "Leave a review" (Google) + a tap-to-call link to the service department.
 * Only rendered once the repair reaches the `ready`/`picked_up` state.
 */
import type { TrackerView } from '@/lib/tracker/types';

interface ReadyActionsProps {
  dealership: TrackerView['dealership'];
}

export default function ReadyActions({ dealership }: ReadyActionsProps) {
  return (
    <section className="flex flex-col gap-3">
      {dealership.google_review_url && (
        <a
          href={dealership.google_review_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center rounded-xl bg-cyan px-5 py-3 font-heading font-semibold text-canvas transition-opacity hover:opacity-90"
        >
          ⭐ Leave a review
        </a>
      )}

      {dealership.phone && (
        <a
          href={`tel:${dealership.phone}`}
          className="flex items-center justify-center rounded-xl border border-border bg-surface px-5 py-3 font-medium text-ink transition-colors hover:border-cyan"
        >
          Call {dealership.name}
        </a>
      )}
    </section>
  );
}
