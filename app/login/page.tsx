/**
 * /login — dual-mode login page
 * ===============================
 * AUTH_MODE=password (default): shows the shared-password form (existing behavior).
 * AUTH_MODE=cognito: immediately redirects to Cognito hosted UI for per-user login.
 *
 * The page fetches /api/auth/login-url on mount to detect the active mode.
 * During the detection phase, a branded loading state is shown.
 */
'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [authMode, setAuthMode] = useState<'loading' | 'password' | 'cognito'>('loading');

  // Detect auth mode on mount
  useEffect(() => {
    const next = params.get('next') || '/intel';
    fetch(`/api/auth/login-url?next=${encodeURIComponent(next)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.mode === 'cognito' && data.loginUrl) {
          // Redirect to Cognito hosted UI immediately
          setAuthMode('cognito');
          window.location.href = data.loginUrl;
        } else {
          setAuthMode('password');
        }
      })
      .catch(() => {
        // If the fetch fails, fall back to password mode
        setAuthMode('password');
      });
  }, [params]);

  // Show any error from Cognito callback (e.g., token exchange failure)
  useEffect(() => {
    const callbackError = params.get('error');
    if (callbackError) {
      const messages: Record<string, string> = {
        no_code: 'Login failed: no authorization code received.',
        token_exchange: 'Login failed: unable to exchange credentials.',
        no_id_token: 'Login failed: no identity token received.',
        config: 'Login configuration error. Contact admin.',
        access_denied: 'Access denied.',
      };
      setError(messages[callbackError] || `Login error: ${callbackError}`);
    }
  }, [params]);

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

  // Loading state while detecting auth mode
  if (authMode === 'loading' || authMode === 'cognito') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-bg">
        <div className="w-full max-w-sm px-6 text-center">
          <div className="mb-4 font-display text-2xl font-bold tracking-tight">
            <span className="text-cyan">Service</span>
            <span className="text-fg">Sync</span>
          </div>
          <p className="text-sm text-muted">
            {authMode === 'cognito' ? 'Redirecting to sign in…' : 'Loading…'}
          </p>
        </div>
      </div>
    );
  }

  // Password mode — existing UI
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
