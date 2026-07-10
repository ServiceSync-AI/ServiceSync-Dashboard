/**
 * Coaching (/intel/coaching) — Advisor Interaction Coach
 * ======================================================
 * Shows recent transcripts with per-interaction coaching cards. Each card
 * displays what went well (green), an improvement area (blue), and a suggested
 * phrase (violet). A "Coach me on this" button triggers the AI analysis.
 *
 * Client component — fetches transcript list on mount, then requests coaching
 * per transcript on demand.
 */
'use client';

import { useEffect, useState } from 'react';

interface TranscriptEntry {
  key: string;
  id: string;
  audioFile: string;
  lastModified: string;
  size: number;
}

interface CoachingResult {
  didWell: string;
  improvement: string;
  suggestedPhrase: string;
  interactionType: string;
}

interface CoachingState {
  loading: boolean;
  result: CoachingResult | null;
  error: string | null;
}

const INTERACTION_BADGES: Record<string, string> = {
  greeting: '👋 Greeting',
  'estimate-presentation': '💰 Estimate',
  'objection-handling': '🛡️ Objection',
  upsell: '📈 Upsell',
  'follow-up': '📞 Follow-up',
  closing: '✅ Closing',
  general: '💬 General',
};

export default function CoachingPage() {
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [coaching, setCoaching] = useState<Record<string, CoachingState>>({});

  useEffect(() => {
    fetch('/api/intel/transcripts/list')
      .then((r) => r.json())
      .then((data: TranscriptEntry[]) => {
        setTranscripts(Array.isArray(data) ? data.slice(0, 20) : []);
      })
      .catch(() => setTranscripts([]))
      .finally(() => setLoading(false));
  }, []);

  async function coachTranscript(entry: TranscriptEntry) {
    setCoaching((prev) => ({
      ...prev,
      [entry.id]: { loading: true, result: null, error: null },
    }));

    try {
      // Fetch the transcript segments
      const transcriptRes = await fetch(`/api/intel/transcripts/${entry.id}`);
      if (!transcriptRes.ok) throw new Error('Failed to load transcript');
      const transcript = await transcriptRes.json();

      // Request coaching analysis
      const coachRes = await fetch('/api/intel/coaching', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript_id: entry.id,
          segments: transcript.segments,
        }),
      });

      if (!coachRes.ok) {
        const err = await coachRes.json();
        throw new Error(err.error ?? 'Coaching request failed');
      }

      const result: CoachingResult = await coachRes.json();
      setCoaching((prev) => ({
        ...prev,
        [entry.id]: { loading: false, result, error: null },
      }));
    } catch (err) {
      setCoaching((prev) => ({
        ...prev,
        [entry.id]: { loading: false, result: null, error: String((err as Error).message) },
      }));
    }
  }

  if (loading) {
    return (
      <div className="px-6 py-5">
        <h1 className="font-display text-xl font-bold tracking-tight">Advisor Coach</h1>
        <p className="mt-2 text-sm text-muted">Loading transcripts…</p>
      </div>
    );
  }

  return (
    <div className="px-6 py-5">
      <header className="mb-5">
        <h1 className="font-display text-xl font-bold tracking-tight">🏋️ Advisor Coach</h1>
        <p className="text-2xs text-muted">
          AI-powered interaction coaching · select a transcript to get personalized feedback
        </p>
      </header>

      {transcripts.length === 0 ? (
        <div className="card text-sm text-muted">
          No transcripts available yet. Record advisor interactions to enable coaching.
        </div>
      ) : (
        <div className="space-y-4">
          {transcripts.map((entry) => {
            const state = coaching[entry.id];
            return (
              <div key={entry.id} className="card">
                {/* Transcript header */}
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-fg">{entry.audioFile}</span>
                    <span className="ml-2 text-2xs text-muted">
                      {new Date(entry.lastModified).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  {!state?.result && (
                    <button
                      onClick={() => coachTranscript(entry)}
                      disabled={state?.loading}
                      className="rounded-md bg-cyan/15 px-3 py-1.5 text-xs font-medium text-cyan transition-colors hover:bg-cyan/25 disabled:opacity-50"
                    >
                      {state?.loading ? 'Analyzing…' : 'Coach me on this'}
                    </button>
                  )}
                </div>

                {/* Error state */}
                {state?.error && (
                  <p className="mt-2 text-xs text-danger">{state.error}</p>
                )}

                {/* Coaching results */}
                {state?.result && (
                  <div className="mt-3 space-y-2">
                    {/* Interaction type badge */}
                    <div className="mb-2">
                      <span className="inline-block rounded-full bg-surface-2 px-2.5 py-0.5 text-2xs font-medium text-fg">
                        {INTERACTION_BADGES[state.result.interactionType] ?? state.result.interactionType}
                      </span>
                    </div>

                    {/* What went well — green */}
                    <div className="rounded-md border border-green-500/20 bg-green-500/5 p-3">
                      <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-green-400">
                        ✓ What went well
                      </div>
                      <p className="text-xs leading-relaxed text-fg/90">
                        {state.result.didWell}
                      </p>
                    </div>

                    {/* Improvement — blue */}
                    <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3">
                      <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-blue-400">
                        ↗ Area to grow
                      </div>
                      <p className="text-xs leading-relaxed text-fg/90">
                        {state.result.improvement}
                      </p>
                    </div>

                    {/* Suggested phrase — violet */}
                    <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3">
                      <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-violet-400">
                        💬 Try this next time
                      </div>
                      <p className="text-xs italic leading-relaxed text-fg/90">
                        &ldquo;{state.result.suggestedPhrase}&rdquo;
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
