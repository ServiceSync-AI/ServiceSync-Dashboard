/**
 * Auth Middleware — simple password gate
 * ======================================
 * This is a founder-only internal tool, not a customer-facing app, so auth is a
 * single shared password rather than real user accounts. The /api/auth route
 * sets an httpOnly `ss_auth` cookie whose value is the sha-256 of the password;
 * here we just check the cookie is present and matches. Anything unauthenticated
 * (except the login page, the auth endpoint, and static assets) is redirected to
 * /login.
 *
 * Note: this runs on the Edge runtime, so we use the Web Crypto API (no Node
 * crypto) to derive the expected token.
 */
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/auth'];

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Let the login page and auth endpoint through untouched.
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const password = process.env.DASHBOARD_PASSWORD ?? '';
  // If no password is configured, fail open in dev rather than locking out.
  if (!password) return NextResponse.next();

  const expected = await sha256Hex(password);
  const token = request.cookies.get('ss_auth')?.value;

  if (token === expected) return NextResponse.next();

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Skip Next internals + static files; gate everything else.
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
