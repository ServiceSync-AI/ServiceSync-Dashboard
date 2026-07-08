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

/* ─── Inline keyframes (no external deps) ─── */
const animationStyles = `
  @keyframes gradient-shift {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
  }
  @keyframes fade-in-up {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes glow-pulse {
    0%, 100% { text-shadow: 0 0 8px rgba(6, 182, 212, 0.4), 0 0 20px rgba(6, 182, 212, 0.1); }
    50% { text-shadow: 0 0 16px rgba(6, 182, 212, 0.7), 0 0 40px rgba(6, 182, 212, 0.2); }
  }
  @keyframes pulse-dot {
    0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); }
    40% { opacity: 1; transform: scale(1.2); }
  }
  @keyframes spin-slow {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
  @keyframes border-glow {
    0%, 100% { border-color: #30363d; box-shadow: 0 0 0 0 rgba(6, 182, 212, 0); }
    50% { border-color: #06B6D4; box-shadow: 0 0 8px 0 rgba(6, 182, 212, 0.15); }
  }
  @keyframes shimmer {
    from { background-position: -200% 0; }
    to { background-position: 200% 0; }
  }
`;

function PulseDots() {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-2 w-2 rounded-full bg-cyan"
          style={{
            animation: 'pulse-dot 1.4s ease-in-out infinite',
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
    </div>
  );
}

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

  // Loading / Cognito redirect state
  if (authMode === 'loading' || authMode === 'cognito') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden">
        {/* Inject animation keyframes */}
        <style dangerouslySetInnerHTML={{ __html: animationStyles }} />

        {/* Animated gradient background */}
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(135deg, #0d1117 0%, #0f1a2e 25%, #1a0f2e 50%, #0d1117 75%, #0f1a2e 100%)',
            backgroundSize: '400% 400%',
            animation: 'gradient-shift 12s ease infinite',
          }}
        />

        {/* Subtle radial glow */}
        <div
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(ellipse at center, rgba(6, 182, 212, 0.03) 0%, transparent 70%)',
          }}
        />

        {/* Content */}
        <div
          className="relative z-10 w-full max-w-sm px-6 text-center"
          style={{ animation: 'fade-in-up 0.6s ease-out both' }}
        >
          {/* Logo */}
          <div className="mb-6 font-display text-3xl font-bold tracking-tight">
            <span
              className="text-cyan"
              style={{ animation: 'glow-pulse 3s ease-in-out infinite' }}
            >
              Service
            </span>
            <span className="text-fg">Sync</span>
          </div>

          {/* Spinner */}
          <div className="mb-5 flex items-center justify-center">
            <div
              className="h-8 w-8 rounded-full border-2 border-border border-t-cyan"
              style={{ animation: 'spin-slow 1s linear infinite' }}
            />
          </div>

          <p className="text-sm text-muted">
            {authMode === 'cognito' ? 'Redirecting to sign in…' : 'Initializing…'}
          </p>

          {/* Pulse dots beneath */}
          <div className="mt-4">
            <PulseDots />
          </div>
        </div>
      </div>
    );
  }

  // Password mode — animated UI
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden">
      {/* Inject animation keyframes */}
      <style dangerouslySetInnerHTML={{ __html: animationStyles }} />

      {/* Animated gradient background */}
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(135deg, #0d1117 0%, #0f1a2e 25%, #1a0f2e 50%, #0d1117 75%, #0f1a2e 100%)',
          backgroundSize: '400% 400%',
          animation: 'gradient-shift 12s ease infinite',
        }}
      />

      {/* Subtle radial glow behind card */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse at center, rgba(6, 182, 212, 0.04) 0%, transparent 60%)',
        }}
      />

      {/* Grid pattern overlay (very subtle) */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(6, 182, 212, 0.3) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(6, 182, 212, 0.3) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Main content */}
      <div
        className="relative z-10 w-full max-w-sm px-6"
        style={{ animation: 'fade-in-up 0.7s ease-out both' }}
      >
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mb-2 font-display text-3xl font-bold tracking-tight">
            <span
              className="text-cyan"
              style={{ animation: 'glow-pulse 3s ease-in-out infinite' }}
            >
              Service
            </span>
            <span className="text-fg">Sync</span>
          </div>
          <p className="text-2xs uppercase tracking-[0.2em] text-muted">
            Pilot Intelligence
          </p>
        </div>

        {/* Card / Form */}
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border/60 p-6 space-y-5 backdrop-blur-sm"
          style={{
            background: 'linear-gradient(145deg, rgba(22, 27, 34, 0.9) 0%, rgba(13, 17, 23, 0.95) 100%)',
            animation: 'fade-in-up 0.9s ease-out both',
            boxShadow: '0 0 40px rgba(6, 182, 212, 0.03), 0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          <div>
            <label className="stat-label mb-1.5 block" htmlFor="password">
              Access password
            </label>
            <input
              id="password"
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg/80 px-4 py-2.5 font-mono text-sm text-fg outline-none transition-all duration-300 placeholder:text-muted/50 focus:border-cyan focus:shadow-[0_0_12px_rgba(6,182,212,0.15)]"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div
              className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2"
              style={{ animation: 'fade-in-up 0.3s ease-out both' }}
            >
              <p className="text-xs text-danger">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !password}
            className="group relative w-full overflow-hidden rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white transition-all duration-300 hover:shadow-[0_0_20px_rgba(10,122,255,0.3)] disabled:opacity-40 disabled:hover:shadow-none"
          >
            {/* Shimmer effect on hover */}
            <span
              className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              style={{
                background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)',
                backgroundSize: '200% 100%',
                animation: 'shimmer 2s linear infinite',
              }}
            />
            <span className="relative">
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span
                    className="inline-block h-4 w-4 rounded-full border-2 border-white/30 border-t-white"
                    style={{ animation: 'spin-slow 0.8s linear infinite' }}
                  />
                  Verifying…
                </span>
              ) : (
                'Enter'
              )}
            </span>
          </button>
        </form>

        {/* Footer */}
        <p
          className="mt-6 text-center text-2xs text-muted/70"
          style={{ animation: 'fade-in-up 1.1s ease-out both' }}
        >
          Founder-only · Chevyland Chevrolet pilot
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary during static generation.
  return (
    <Suspense
      fallback={
        <div className="fixed inset-0 bg-bg">
          <style dangerouslySetInnerHTML={{ __html: animationStyles }} />
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(135deg, #0d1117 0%, #0f1a2e 25%, #1a0f2e 50%, #0d1117 75%, #0f1a2e 100%)',
              backgroundSize: '400% 400%',
              animation: 'gradient-shift 12s ease infinite',
            }}
          />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
