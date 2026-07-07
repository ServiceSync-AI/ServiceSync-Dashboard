/**
 * StepTracker — the "pizza tracker" dots
 * ====================================
 * Five dots connected by lines. Completed stages are filled cyan, the current
 * stage pulses/glows, future stages are muted. Mobile-first: the row fits five
 * dots across a phone screen with short labels beneath.
 */
import { TRACKER_STEPS, STATUS_LABELS, statusToStepIndex, type RepairStatus } from '@/lib/tracker/statuses';

interface StepTrackerProps {
  status: RepairStatus;
}

export default function StepTracker({ status }: StepTrackerProps) {
  const currentIndex = statusToStepIndex(status);

  return (
    <div className="flex w-full items-start justify-between" aria-label="Repair progress">
      {TRACKER_STEPS.map((step, index) => {
        const isComplete = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isLast = index === TRACKER_STEPS.length - 1;

        return (
          <div key={step} className="relative flex flex-1 flex-col items-center">
            {/* Connector line to the next dot. Cyan once this stage is done. */}
            {!isLast && (
              <span
                className={`absolute left-1/2 top-[11px] -z-10 h-0.5 w-full ${
                  isComplete ? 'bg-cyan' : 'bg-border'
                }`}
                aria-hidden="true"
              />
            )}

            {/* The dot. */}
            <span
              className={[
                'flex h-6 w-6 items-center justify-center rounded-full border-2 transition-colors',
                isCurrent
                  ? 'border-cyan bg-cyan animate-pulse-glow'
                  : isComplete
                    ? 'border-cyan bg-cyan'
                    : 'border-border bg-surface',
              ].join(' ')}
              aria-current={isCurrent ? 'step' : undefined}
            >
              {isComplete && (
                // Checkmark for finished stages.
                <svg viewBox="0 0 12 12" className="h-3 w-3 text-canvas" aria-hidden="true">
                  <path
                    d="M2 6.5L4.5 9L10 3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </span>

            {/* Label. */}
            <span
              className={`mt-2 text-center text-[10px] leading-tight sm:text-xs ${
                isCurrent ? 'font-semibold text-cyan' : isComplete ? 'text-ink' : 'text-muted'
              }`}
            >
              {STATUS_LABELS[step]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
