'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdvisorSelector from './AdvisorSelector';
import LogoutButton from './LogoutButton';

const NAV_ITEMS = [
  { href: '/intel', label: 'Intel', icon: '📊', description: 'System health & overview' },
  { href: '/intel/scorecard', label: 'Scorecard', icon: '🎯', description: 'Daily productivity score' },
  { href: '/intel/compare', label: 'Compare', icon: '⚖️', description: 'Before/after comparison' },
  { href: '/intel/audio', label: 'Audio', icon: '🎙️', description: 'Recordings & transcripts' },
  { href: '/intel/activity', label: 'Activity', icon: '📈', description: 'Session timeline' },
  { href: '/intel/insights', label: 'Insights', icon: '💡', description: 'Daily summary' },
  { href: '/intel/recovery', label: 'Recovery', icon: '💵', description: 'Declined work' },
  { href: '/intel/usage', label: 'Usage & Cost', icon: '💰', description: 'Per-advisor spend' },
  { href: '/intel/audits', label: 'Audits', icon: '📄', description: 'Nightly reports' },
  { href: '/intel/report', label: 'Weekly Report', icon: '📋', description: 'Weekly pilot summary' },
  { href: '/intel/conversations', label: 'Conversations', icon: '💬', description: 'Assistant chat history' },
  { href: '/intel/coaching', label: 'Coach', icon: '🏋️', description: 'Interaction coaching' },
  { href: '/intel/mpi', label: 'MPI Estimate', icon: '📸', description: 'Photo → AI estimate' },
  { href: '/intel/voice-ro', label: 'Voice RO', icon: '🎤', description: 'Speech-to-repair-order' },
  { href: '/intel/predict', label: 'Predict', icon: '🔮', description: 'Predictive scheduling' },
  { href: '/intel/live', label: 'Live', icon: '⚡', description: 'Remote actions' },
  { href: '/console', label: 'Repair Board', icon: '🔧', description: 'Advisor console' },
  { href: '/tracker', label: 'Tracker', icon: '🚗', description: 'Customer status' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-56 flex-col border-r border-border bg-surface">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <span className="text-lg">⚡</span>
        <span className="font-semibold text-fg">ServiceSync</span>
      </div>
      <nav className="flex-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || (item.href !== '/intel' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-cyan/10 text-cyan font-medium'
                  : 'text-muted hover:bg-surface-2 hover:text-fg'
              }`}
            >
              <span className="text-base">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-border p-3">
        <AdvisorSelector />
      </div>
      <div className="border-t border-border p-3 text-xs text-muted">
        Chevyland Chevrolet • Pilot
        <div className="mt-2">
          <LogoutButton />
        </div>
      </div>
    </aside>
  );
}
