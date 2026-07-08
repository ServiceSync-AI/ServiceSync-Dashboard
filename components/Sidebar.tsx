'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AdvisorSelector from './AdvisorSelector';

const NAV_ITEMS = [
  { href: '/intel', label: 'Intel', icon: '📊', description: 'System health & overview' },
  { href: '/intel/audio', label: 'Audio', icon: '🎙️', description: 'Recordings & transcripts' },
  { href: '/intel/activity', label: 'Activity', icon: '📈', description: 'Session timeline' },
  { href: '/intel/insights', label: 'Insights', icon: '💡', description: 'Daily summary' },
  { href: '/intel/recovery', label: 'Recovery', icon: '💵', description: 'Declined work' },
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
      </div>
    </aside>
  );
}
