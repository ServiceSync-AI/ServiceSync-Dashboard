/**
 * /login — password gate UI
 * ==========================
 * Full-screen overlay (fixed inset-0) so it covers the sidebar shell from the
 * root layout. Posts the password to /api/auth; on success, navigates to the
 * `next` param (where the user was headed before the redirect).
 */
'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        const next = params.get('next') || '/';
        router.replace(next);
        router.refresh();
      } else {
        setError('Incorrect password.');
      }
    } catch {
      setError('Something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg">
      <div className="w-full max-w-sm px-6">
        <div className="mb-8 text-center">
          <div className="mb-2 font-display text-2xl font-bold tracking-tight">
            <span className="text-cyan">Service</span>
            <span className="text-fg">Sync</span>
          </div>
          <p className="text-2xs uppercase tracking-[0.2em] text-muted">
            Pilot Intelligence
          </p>
        </div>
        <form onSubmit={handleSubmit} className="card space-y-4">
          <div>
            <label className="stat-label mb-1 block" htmlFor="password">
              Access password
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-border bg-bg px-3 py-2 font-mono text-sm text-fg outline-none focus:border-cyan"
              placeholder="••••••••"
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full rounded bg-brand px-3 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {loading ? 'Verifying…' : 'Enter'}
          </button>
        </form>
        <p className="mt-4 text-center text-2xs text-muted">
          Founder-only · Chevyland Chevrolet pilot
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary during static generation.
  return (
    <Suspense fallback={<div className="fixed inset-0 bg-bg" />}>
      <LoginForm />
    </Suspense>
  );
}
