/**
 * POST /api/auth — exchange the shared password for an auth cookie
 * ================================================================
 * Verifies the submitted password against DASHBOARD_PASSWORD and, on success,
 * sets an httpOnly cookie holding sha-256(password). The middleware checks this
 * cookie on every request. DELETE clears it (logout).
 */
import { NextResponse } from 'next/server';
import crypto from 'node:crypto';

export const runtime = 'nodejs';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export async function POST(request: Request) {
  const password = process.env.DASHBOARD_PASSWORD ?? '';
  let submitted = '';
  try {
    const body = await request.json();
    submitted = typeof body?.password === 'string' ? body.password : '';
  } catch {
    return NextResponse.json({ ok: false, error: 'bad request' }, { status: 400 });
  }

  if (!password || submitted !== password) {
    return NextResponse.json({ ok: false, error: 'invalid password' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set('ss_auth', sha256Hex(password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    // Re-auth weekly — this is an internal tool, not high-security.
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete('ss_auth');
  return response;
}
