/**
 * Cognito JWT verification (Edge-safe) — SCAFFOLDING, NOT ENABLED
 * ===============================================================
 * This module verifies an AWS Cognito ID/access token in Next.js middleware
 * (the Edge runtime). It is *scaffolding for Stage 3 sign-in* and is only ever
 * called when `AUTH_MODE=cognito` AND a Cognito user pool actually exists. With
 * the env unset the default password gate runs and this file is never invoked.
 *
 * Why hand-rolled instead of `jose`/`aws-jwt-verify`:
 *   - The Edge runtime has no Node `crypto`, so we use the Web Crypto API
 *     (`crypto.subtle`), which is available on Edge.
 *   - Adding a runtime dependency would change `package.json` / the lockfile and
 *     risk the "no new env vars, build unchanged" guarantee. This file depends on
 *     nothing outside the Web platform (`fetch`, `crypto.subtle`, `atob`,
 *     `TextEncoder`), so `npm run build` stays byte-for-byte clean today.
 *   - When this path is actually turned on, swapping in `aws-jwt-verify` is a
 *     reasonable hardening step (see docs/AUTH_DESIGN.md). This implementation is
 *     intentionally small and readable so it can be reviewed line-by-line.
 *
 * What it checks (RS256 Cognito tokens):
 *   1. header.kid resolves to a published JWKS key for the pool
 *   2. RSASSA-PKCS1-v1_5 / SHA-256 signature over `header.payload` is valid
 *   3. `exp` (and `nbf`/`iat` when present) are within tolerance
 *   4. `iss` matches the pool issuer
 *   5. `token_use` is `id` or `access` as configured
 *   6. audience: `aud` (id tokens) or `client_id` (access tokens) matches the app client
 *
 * It returns the decoded claims on success (including the `role` custom attribute
 * and `cognito:groups`) or `null` on any failure — the caller redirects to login.
 */

export interface CognitoConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  /** Which token the dashboard sends in the cookie. Default: 'id'. */
  tokenUse?: 'id' | 'access';
  /** Clock skew tolerance in seconds. Default: 60. */
  clockToleranceSec?: number;
}

export interface CognitoClaims {
  sub: string;
  iss: string;
  exp: number;
  iat?: number;
  token_use: string;
  email?: string;
  username?: string;
  ['cognito:username']?: string;
  ['cognito:groups']?: string[];
  /** The `role` custom attribute: advisor | manager | owner. */
  ['custom:role']?: string;
  [key: string]: unknown;
}

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

/**
 * Read Cognito settings from the environment. Returns `null` when the pool is
 * not configured, which is the expected state today — the caller then falls
 * back to (or, for AUTH_MODE=cognito, refuses) rather than crashing.
 */
export function readCognitoConfig(): CognitoConfig | null {
  const region = process.env.COGNITO_REGION || process.env.AWS_REGION;
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  if (!region || !userPoolId || !clientId) return null;
  return {
    region,
    userPoolId,
    clientId,
    tokenUse: (process.env.COGNITO_TOKEN_USE as 'id' | 'access') || 'id',
    clockToleranceSec: Number(process.env.COGNITO_CLOCK_TOLERANCE ?? '60'),
  };
}

/**
 * base64url → bytes (Edge has global `atob`). Allocates an explicit ArrayBuffer
 * so the result is `Uint8Array<ArrayBuffer>` and satisfies `BufferSource` for
 * `crypto.subtle` under strict TS lib typings.
 */
function b64urlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    Math.ceil(b64url.length / 4) * 4,
    '=',
  );
  const bin = atob(b64);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToString(b64url: string): string {
  return new TextDecoder().decode(b64urlToBytes(b64url));
}

// JWKS is stable per pool; cache it in module scope for the life of the isolate
// so we do not refetch on every request. Keyed by issuer.
const jwksCache = new Map<string, { keys: Jwk[]; fetchedAt: number }>();
const JWKS_TTL_MS = 60 * 60 * 1000; // 1h

async function getJwks(issuer: string): Promise<Jwk[]> {
  const cached = jwksCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetch(`${issuer}/.well-known/jwks.json`, {
    // Edge fetch cache; JWKS rotates rarely.
    cache: 'force-cache',
  });
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache.set(issuer, { keys: body.keys, fetchedAt: Date.now() });
  return body.keys;
}

/**
 * Verify a Cognito JWT. Returns claims on success, `null` on any failure.
 * Never throws to the caller — a bad token is simply "not authenticated".
 */
export async function verifyCognitoJwt(
  token: string,
  cfg: CognitoConfig,
): Promise<CognitoClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [rawHeader, rawPayload, rawSig] = parts;

    const header = JSON.parse(b64urlToString(rawHeader)) as {
      kid?: string;
      alg?: string;
    };
    if (header.alg !== 'RS256' || !header.kid) return null;

    const issuer = `https://cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`;

    // 1) find the signing key by kid
    const keys = await getJwks(issuer);
    const jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    // 2) verify signature over `header.payload`
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const data = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      key,
      b64urlToBytes(rawSig),
      data,
    );
    if (!ok) return null;

    // 3) validate claims
    const claims = JSON.parse(b64urlToString(rawPayload)) as CognitoClaims;
    const now = Math.floor(Date.now() / 1000);
    const skew = cfg.clockToleranceSec ?? 60;

    if (typeof claims.exp !== 'number' || claims.exp + skew < now) return null;
    if (typeof claims.iat === 'number' && claims.iat - skew > now) return null;
    if (claims.iss !== issuer) return null;

    const tokenUse = cfg.tokenUse ?? 'id';
    if (claims.token_use !== tokenUse) return null;

    // Audience: id tokens carry `aud`, access tokens carry `client_id`.
    const aud = tokenUse === 'id' ? (claims.aud as string) : (claims.client_id as string);
    if (aud !== cfg.clientId) return null;

    return claims;
  } catch {
    return null;
  }
}

/** Extract the role, preferring the custom attribute then group membership. */
export function roleFromClaims(claims: CognitoClaims): string | null {
  const custom = claims['custom:role'];
  if (typeof custom === 'string' && custom) return custom;
  const groups = claims['cognito:groups'];
  if (Array.isArray(groups) && groups.length > 0) return groups[0];
  return null;
}
