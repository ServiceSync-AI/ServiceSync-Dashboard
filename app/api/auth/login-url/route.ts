/**
 * GET /api/auth/login-url — returns the auth mode and login URL
 * ==============================================================
 * The login page calls this to determine whether to show the password field
 * (AUTH_MODE=password) or redirect to the Cognito hosted UI (AUTH_MODE=cognito).
 *
 * Response:
 *   { mode: "password" }
 * or:
 *   { mode: "cognito", loginUrl: "https://servicesync-auth.auth..." }
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authMode = (process.env.AUTH_MODE ?? 'password').toLowerCase();

  if (authMode !== 'cognito') {
    return NextResponse.json({ mode: 'password' });
  }

  const domain = process.env.COGNITO_DOMAIN ?? '';
  const clientId = process.env.COGNITO_CLIENT_ID ?? '';
  const redirectUri = process.env.COGNITO_REDIRECT_URI ?? '';

  if (!domain || !clientId || !redirectUri) {
    // Cognito requested but not configured — fall back to password display
    return NextResponse.json({ mode: 'password' });
  }

  // Where to redirect after login (from query param or default to /intel)
  const next = request.nextUrl.searchParams.get('next') || '/intel';

  const loginUrl =
    `https://${domain}/login?` +
    `client_id=${encodeURIComponent(clientId)}&` +
    `response_type=code&` +
    `scope=${encodeURIComponent('openid email profile')}&` +
    `redirect_uri=${encodeURIComponent(redirectUri)}&` +
    `state=${encodeURIComponent(next)}`;

  return NextResponse.json({ mode: 'cognito', loginUrl });
}
