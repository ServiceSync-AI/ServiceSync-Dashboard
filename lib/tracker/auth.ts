/**
 * Write-endpoint Authentication
 * ====================================
 * The Chrome extension calls POST /api/create and /api/update with a shared
 * secret in the `x-api-key` header. This gates those write endpoints so the
 * public can't create fake repair orders or fire SMS messages.
 *
 * Read endpoints (/api/status, /api/rewards) are intentionally unauthenticated
 * but only ever return non-sensitive, code-scoped data.
 */
import { NextRequest } from 'next/server';

/**
 * Verify the request carries the correct API key.
 *
 * Returns true only when TRACKER_API_KEY is configured AND matches the header.
 * If the secret isn't configured we deny — failing closed is safer than
 * accidentally exposing write access in a misconfigured deploy.
 */
export function isAuthorizedWrite(req: NextRequest): boolean {
  const expected = process.env.TRACKER_API_KEY;
  if (!expected) return false;
  return req.headers.get('x-api-key') === expected;
}
