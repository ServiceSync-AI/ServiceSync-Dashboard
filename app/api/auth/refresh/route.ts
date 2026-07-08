/**
 * POST /api/auth/refresh — silently refresh Cognito tokens
 * =========================================================
 * Called by the client (or middleware retry logic) when the id token is expired
 * or about to expire. Uses the ss_refresh cookie to obtain new tokens from
 * Cognito and updates the ss_id cookie.
 *
 * Returns 200 { ok: true } on success, 401 on failure (client should redirect
 * to login).
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const domain = process.env.COGNITO_DOMAIN ?? '';
  const clientId = process.env.COGNITO_CLIENT_ID ?? '';

  if (!domain || !clientId) {
    return NextResponse.json({ error: 'cognito_not_configured' }, { status: 500 });
  }

  const refreshToken = request.cookies.get('ss_refresh')?.value;
  if (!refreshToken) {
    return NextResponse.json({ error: 'no_refresh_token' }, { status: 401 });
  }

  let tokens: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };

  try {
    const tokenRes = await fetch(`https://${domain}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        refresh_token: refreshToken,
      }),
    });

    if (!tokenRes.ok) {
      const errBody = await tokenRes.text();
      console.error('[auth/refresh] Refresh failed:', tokenRes.status, errBody);
      // Refresh failed — clear cookies, force re-login
      const response = NextResponse.json({ error: 'refresh_failed' }, { status: 401 });
      response.cookies.delete('ss_id');
      response.cookies.delete('ss_refresh');
      return response;
    }

    tokens = await tokenRes.json();
  } catch (err) {
    console.error('[auth/refresh] Exception:', err);
    return NextResponse.json({ error: 'refresh_error' }, { status: 500 });
  }

  const response = NextResponse.json({ ok: true });
  const isProduction = process.env.NODE_ENV === 'production';

  if (tokens.id_token) {
    response.cookies.set('ss_id', tokens.id_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 3600,
      path: '/',
    });
  }

  // Cognito may or may not return a new refresh token on refresh
  if (tokens.refresh_token) {
    response.cookies.set('ss_refresh', tokens.refresh_token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 3600,
      path: '/',
    });
  }

  return response;
}
