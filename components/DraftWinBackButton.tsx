'use client';
/**
 * DraftWinBackButton — generate + save a win-back SMS draft for a declined item
 * ============================================================================
 * Per-item control on the recovery page. POSTs the declined item to
 * /api/intel/recovery/outreach, which drafts a short win-back SMS (Claude Haiku)
 * and logs it to DynamoDB. Shows the draft with a copy affordance and a note
 * that it was saved to the outreach log.
 *
 * SMS SEND IS OFF: this only drafts + logs. The UI shows sending as "not
 * enabled" — nothing is ever sent to a customer from here.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { DeclinedItem } from '@/lib/recovery';

interface OutreachResponse {
  record?: { draft_text: string };
  smsEnabled?: boolean;
  error?: string;
  detail?: string;
}

export default function DraftWinBackButton({ item }: { item: DeclinedItem }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function draftIt() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/intel/recovery/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item }),
      });
      const data = (await res.json()) as OutreachResponse;
      if (!res.ok || !data.record) {
        throw new Error(data.detail || data.error || `request failed (${res.status})`);
      }
      setDraft(data.record.draft_text);
      setSmsEnabled(Boolean(data.smsEnabled));
      // Refresh the server-rendered outreach log so the new draft shows up there.
      router.refresh();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <div className="mt-3">
      {!draft ? (
        <button
          onClick={draftIt}
          disabled={loading}
          className="rounded-md border border-cyan/40 bg-cyan/10 px-2.5 py-1.5 text-2xs font-medium text-cyan transition-colors hover:bg-cyan/20 disabled:opacity-50"
        >
          {loading ? 'Drafting…' : 'Draft win-back text'}
        </button>
      ) : (
        <div className="rounded-md border border-border bg-surface-2 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="stat-label">Win-back draft</span>
            <button
              onClick={copy}
              className="rounded border border-border bg-surface px-1.5 py-0.5 text-2xs text-muted transition-colors hover:border-muted/60 hover:text-fg"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-fg/90">{draft}</p>
          <p className="mt-2 text-2xs text-muted">
            Saved to outreach log ·{' '}
            <span className="text-warn">
              SMS send {smsEnabled ? 'enabled (manual review required)' : 'not enabled'}
            </span>
          </p>
        </div>
      )}
      {error && <p className="mt-1.5 font-mono text-2xs text-danger">{error}</p>}
    </div>
  );
}
