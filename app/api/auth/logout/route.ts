/**
 * POST /api/auth/logout — sign out and clear session
 * ===================================================
 * Clears all auth cookies (ss_id, ss_refresh, and the legacy ss_auth) and
 * redirects the user to Cognito's logout endpoint, which invalidates the
 * server-side session and redirects back to /login.
 *
 * Supports both AUTH_MODE=cognito (redirects to Cognito logout) and
 * AUTH_MODE=password (just clears cookies and redirects to /login).
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const authMode = (process.env.AUTH_MODE ?? 'password').toLowerCase();
  const domain = process.env.COGNITO_DOMAIN ?? '';
  const clientId = process.env.COGNITO_CLIENT_ID ?? '';
  const logoutRedirect = process.env.COGNITO_LOGOUT_URI || 'https://dashboard.servicesync.io/login';

  // Clear all auth cookies regardless of mode
  const clearCookies = (res: NextResponse) => {
    res.cookies.delete('ss_id');
    res.cookies.delete('ss_refresh');
    res.cookies.delete('ss_auth'); // legacy password cookie
    return res;
  };

  if (authMode === 'cognito' && domain && clientId) {
    // Redirect to Cognito's logout endpoint, which will:
    // 1. Invalidate the Cognito session
    // 2. Redirect back to our login page (logout_uri)
    const cognitoLogoutUrl =
      `https://${domain}/logout?` +
      `client_id=${encodeURIComponent(clientId)}&` +
      `logout_uri=${encodeURIComponent(logoutRedirect)}`;

    const response = NextResponse.redirect(cognitoLogoutUrl);
    return clearCookies(response);
  }

  // Password mode or Cognito not configured — just clear cookies and go to /login
  const response = NextResponse.redirect(new URL('/login', request.url));
  return clearCookies(response);
}
