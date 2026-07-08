'use client';
/**
 * ConversationAdvisorSelector — page-local advisor picker for Conversations
 * ========================================================================
 * A small dark-theme <select> of the advisor ids that actually have recorded
 * conversations. On change it sets the `ss_advisor` cookie (the same cookie the
 * sidebar selector and every advisor-aware page read) and calls
 * router.refresh() so the server component re-renders for the newly selected
 * advisor.
 *
 * Why a page-local selector rather than only the sidebar one: this list is
 * sourced from the conversations table itself, so it can offer advisors that
 * have chat history but aren't (yet) in the `servicesync-advisors` directory.
 */
import { useRouter } from 'next/navigation';

export default function ConversationAdvisorSelector({
  advisors,
  selected,
}: {
  advisors: string[];
  selected: string;
}) {
  const router = useRouter();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    // path=/ so every route sees it; ~1yr expiry so the choice sticks.
    document.cookie = `ss_advisor=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  if (advisors.length === 0) return null;

  return (
    <label className="block">
      <span className="stat-label mb-1 block">Advisor</span>
      <select
        value={selected}
        onChange={onChange}
        className="rounded-md border border-border bg-surface-2 px-2 py-1.5 text-sm text-fg outline-none transition-colors hover:border-muted/60 focus:border-cyan"
      >
        {advisors.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </select>
    </label>
  );
}
