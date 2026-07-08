/**
 * Auth Middleware — shared-password gate (default) with a scaffolded Cognito mode
 * ===============================================================================
 * DEFAULT BEHAVIOR IS UNCHANGED. With `AUTH_MODE` unset (or `"password"`) this
 * runs the exact single shared-password gate it always has: the /api/auth route
 * sets an httpOnly `ss_auth` cookie whose value is the sha-256 of the password;
 * here we just check the cookie is present and matches, redirecting anything
 * unauthenticated to /login.
 *
 * `AUTH_MODE=cognito` switches to per-user Cognito JWT validation (Stage 3 real
 * sign-in). That path is SCAFFOLDING — it is never active unless the env is set
 * AND a Cognito user pool exists (COGNITO_USER_POOL_ID / COGNITO_CLIENT_ID /
 * region). See docs/AUTH_DESIGN.md.
 *
 * Note: this runs on the Edge runtime, so we use the Web Crypto API (no Node
 * crypto) to derive the expected token / verify the JWT.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  readCognitoConfig,
  verifyCognitoJwt,
  type CognitoClaims,
} from '@/lib/auth/cognito-edge';

const PUBLIC_PATHS = ['/login', '/api/auth'];

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function redirectToLogin(request: NextRequest, pathname: string) {
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

/**
 * Original shared-password gate — byte-for-byte the behavior that ships today.
 * This is the default branch and must not change.
 */
async function passwordGate(request: NextRequest, pathname: string) {
  const password = process.env.DASHBOARD_PASSWORD ?? '';
  // No password configured: fail OPEN in dev (convenience), fail CLOSED in
  // production (a missing env var must never expose the dashboard publicly).
  // NOTE: DASHBOARD_PASSWORD MUST be set on the production host, or the
  // dashboard is intentionally inaccessible.
  if (!password) {
    if (process.env.NODE_ENV === 'production') {
      return redirectToLogin(request, pathname);
    }
    return NextResponse.next();
  }

  const expected = await sha256Hex(password);
  const token = request.cookies.get('ss_auth')?.value;

  if (token === expected) return NextResponse.next();

  return redirectToLogin(request, pathname);
}

/**
 * Cognito JWT gate — SCAFFOLDING, only reached when AUTH_MODE=cognito.
 * Reads a bearer token from the `ss_id` cookie (set by the hosted-UI callback in
 * the Stage 3 design) or the Authorization header, verifies it against the pool
 * JWKS, and — if configured — enforces a minimum role. Never active until the
 * env is set and a Cognito pool exists.
 */
async function cognitoGate(request: NextRequest, pathname: string) {
  const cfg = readCognitoConfig();
  // AUTH_MODE=cognito but no pool configured: fail CLOSED. We never silently
  // fall back to the password gate here, because operating in "cognito" mode
  // without a pool would be a misconfiguration, not a valid state.
  if (!cfg) return redirectToLogin(request, pathname);

  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const token = request.cookies.get('ss_id')?.value ?? bearer ?? '';
  if (!token) return redirectToLogin(request, pathname);

  const claims: CognitoClaims | null = await verifyCognitoJwt(token, cfg);
  if (!claims) return redirectToLogin(request, pathname);

  // Optional coarse RBAC: COGNITO_REQUIRED_ROLES="manager,owner" would gate the
  // whole app. Fine-grained per-route/per-page checks live in the app itself.
  const required = (process.env.COGNITO_REQUIRED_ROLES ?? '')
    .split(',')
    .map((r) => r.trim())
    .filter(Boolean);
  if (required.length > 0) {
    const role =
      (typeof claims['custom:role'] === 'string' && claims['custom:role']) ||
      (Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'][0] : '');
    if (!role || !required.includes(role)) {
      return redirectToLogin(request, pathname);
    }
  }

  // Forward the verified identity to downstream handlers/pages via request
  // headers so they never have to re-verify or trust a self-declared id.
  const res = NextResponse.next();
  res.headers.set('x-ss-user', String(claims.sub));
  const role =
    (typeof claims['custom:role'] === 'string' && claims['custom:role']) || '';
  if (role) res.headers.set('x-ss-role', role);
  return res;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let the login page and auth endpoint through untouched (both modes).
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  // Cognito path is scaffolding — not enabled until AUTH_MODE=cognito and the
  // Cognito pool exists. Default (unset / "password") is the original gate.
  const authMode = (process.env.AUTH_MODE ?? 'password').toLowerCase();
  if (authMode === 'cognito') {
    return cognitoGate(request, pathname);
  }

  return passwordGate(request, pathname);
}

export const config = {
  // Skip Next internals + static files; gate everything else.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
