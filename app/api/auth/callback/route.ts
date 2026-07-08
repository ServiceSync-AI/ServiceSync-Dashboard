/**
 * GET /api/auth/callback — Cognito hosted UI redirect handler
 * ============================================================
 * After a user logs in via the Cognito hosted UI, they are redirected here with
 * an authorization code. This route exchanges the code for tokens (id, access,
 * refresh) and stores them in httpOnly cookies so middleware can validate the
 * JWT on every subsequent request.
 *
 * Only active when AUTH_MODE=cognito. When AUTH_MODE=password (default), this
 * route is unreachable in practice but harmless.
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const COGNITO_DOMAIN = () => process.env.COGNITO_DOMAIN ?? '';
const CLIENT_ID = () => process.env.COGNITO_CLIENT_ID ?? '';
const REDIRECT_URI = () => process.env.COGNITO_REDIRECT_URI ?? '';

export async function GET(request: NextRequest) {
  const domain = COGNITO_DOMAIN();
  const clientId = CLIENT_ID();
  const redirectUri = REDIRECT_URI();

  if (!domain || !clientId || !redirectUri) {
    console.error('[auth/callback] Missing COGNITO_DOMAIN, COGNITO_CLIENT_ID, or COGNITO_REDIRECT_URI');
    return NextResponse.redirect(new URL('/login?error=config', request.url));
  }

  const code = request.nextUrl.searchParams.get('code');
  const state = request.nextUrl.searchParams.get('state');
  const error = request.nextUrl.searchParams.get('error');

  // Cognito may redirect with an error (e.g., user cancelled)
  if (error) {
    console.error('[auth/callback] Cognito error:', error);
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, request.url));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=no_code', request.url));
  }

  // Exchange authorization code for tokens
  let tokens: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  try {
    const tokenRes = await fetch(`https://${domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[auth/callback] Token exchange failed:', tokenRes.status, errBody);
      return NextResponse.redirect(new URL('/login?error=token_exchange', request.url));
    }

    tokens = await tokenRes.json();
  } catch (err) {
    console.error('[auth/callback] Token exchange exception:', err);
    return NextResponse.redirect(new URL('/login?error=token_exchange', request.url));
  }

  if (!tokens.id_token) {
    console.error('[auth/callback] No id_token in response');
    return NextResponse.redirect(new URL('/login?error=no_id_token', request.url));
  }

  // Redirect to the page the user originally wanted (from `state`) or /intel
  const redirectTo = state || '/intel';
  const response = NextResponse.redirect(new URL(redirectTo, request.url));

  const isProduction = process.env.NODE_ENV === 'production';

  // ss_id — the JWT that middleware validates on every request
  response.cookies.set('ss_id', tokens.id_token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 3600, // 1 hour (matches Cognito id token validity)
    path: '/',
  });

  // ss_refresh — long-lived token for silent renewal
  if (tokens.refresh_token) {
    response.cookies.set('ss_refresh', tokens.refresh_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 3600, // 30 days
      path: '/',
    });
  }

  return response;
}
