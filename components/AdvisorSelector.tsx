'use client';
/**
 * AdvisorSelector — multi-advisor foundation
 * ==========================================
 * A small dark-theme <select> of registered advisors. On change it sets the
 * `ss_advisor` cookie (read server-side via next/headers on advisor-aware
 * pages) and calls router.refresh() so server components re-render for the
 * newly selected advisor. Fed by GET /api/intel/advisors.
 *
 * Additive & non-breaking: if only one advisor is registered the control still
 * renders but has nothing to switch between (the pilot default, siltaylor).
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Advisor {
  advisorId: string;
  advisorName: string;
  dealership: string;
}

/** Read a cookie value client-side (the selector is a client component). */
function readCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)'),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export default function AdvisorSelector() {
  const router = useRouter();
  const [advisors, setAdvisors] = useState<Advisor[]>([]);
  const [selected, setSelected] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/intel/advisors')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Advisor[]) => {
        if (cancelled || !Array.isArray(data)) return;
        setAdvisors(data);
        const current = readCookie('ss_advisor');
        // Prefer the cookie if it names a known advisor, else first in the list.
        const initial =
          current && data.some((a) => a.advisorId === current)
            ? current
            : data[0]?.advisorId ?? '';
        setSelected(initial);
      })
      .catch(() => {
        /* keep the selector empty — pages fall back to config.advisorId */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    setSelected(value);
    // path=/ so every route sees it; ~1yr expiry so the choice sticks.
    document.cookie = `ss_advisor=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  if (advisors.length === 0) return null;

  return (
    <label className="block">
      <span className="stat-label mb-1 block px-1">Advisor</span>
      <select
        value={selected}
        onChange={onChange}
        className="w-full rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none transition-colors hover:border-muted/60 focus:border-cyan"
      >
        {advisors.map((a) => (
          <option key={a.advisorId} value={a.advisorId}>
            {a.advisorName}
            {a.dealership ? ` · ${a.dealership}` : ''}
          </option>
        ))}
      </select>
    </label>
  );
}
