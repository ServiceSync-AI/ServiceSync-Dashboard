# Stage 3 Sign-In Design — Real Per-User Auth (Cognito)

> Status: **DESIGN + NON-DEPLOYED SCAFFOLD.** Nothing in this document is live.
> The dashboard ships today with a single shared password and the extension
> self-declares its `advisor_id`. This document describes how we replace both
> with verified, per-user identity backed by an AWS Cognito user pool — and how
> we get there without breaking the running pilot.

---

## 0. TL;DR

- **Dashboard:** move from one shared `DASHBOARD_PASSWORD` to per-user logins in
  a **Cognito user pool**, with a `role` custom attribute (`advisor` / `manager`
  / `owner`). `middleware.ts` validates a Cognito JWT instead of the sha-256
  password cookie. Gated behind `AUTH_MODE=cognito` (default off).
- **Extension:** move from self-declared `advisor_id` to a **verified** identity
  via the **OAuth 2.0 Device Authorization Grant** (RFC 8628) against the same
  pool. The advisor signs in once; the `advisor_id` is then the Cognito `sub`
  (or a mapped stable id) carried in a signed access token — not a string the
  client picks. (Design only — no extension code changes in this PR.)
- **Interim identity (Stage 2):** the existing `servicesync-advisors` DynamoDB
  table + per-user access codes remain the source of truth for "who is a valid
  advisor" until Cognito is populated. Cognito becomes the identity provider;
  the table becomes a profile/mapping store.
- **Rollout:** dashboard first (low blast radius, one host), extension second
  (fleet of installed clients, needs a staged token migration).

---

## 1. Where we are today (baseline)

### Dashboard
- `middleware.ts` — Edge middleware. Reads `DASHBOARD_PASSWORD`; the `/api/auth`
  route sets an httpOnly `ss_auth` cookie = `sha256(password)`; middleware
  redirects anything without a matching cookie to `/login`. Fails **open** in
  dev, **closed** in production when the env is unset.
- `app/login/page.tsx` — single password field, posts to `/api/auth`.
- `app/api/auth/route.ts` — Node runtime; verifies the password, sets/clears the
  cookie. Weekly `maxAge`.
- One shared secret → no per-user identity, no roles, no audit of *who* did what.

### Extension / capture
- Each advisor's client **self-registers** into the `servicesync-advisors`
  DynamoDB table (`advisor_id` PK, `advisor_name`, `dealership`, `station`,
  `created_at`) and stamps captured data (audio keys, event prefixes) with that
  self-declared `advisor_id`. There is a shared pilot enrollment code
  (`PILOT01`). Nothing verifies that the client claiming `siltaylor` *is*
  siltaylor — the id is a convention, not an assertion.

### Stage 2 (interim, already in flight)
- `servicesync-advisors` table + **per-user access codes**: each advisor gets a
  unique code instead of the shared `PILOT01`. This is the bridge — it gives us
  a per-user secret we can retire code-by-code as users move to Cognito.

---

## 2. Target architecture

```
                        ┌──────────────────────────────┐
                        │   Cognito User Pool           │
                        │   servicesync-users           │
                        │   - users (email + password)  │
                        │   - custom:role attribute     │
                        │   - groups: advisor/manager/   │
                        │       owner (RBAC)             │
                        │   - app client: dashboard      │
                        │   - app client: extension      │
                        │       (device grant + PKCE)    │
                        └───────────┬──────────────┬─────┘
                                    │ JWT (RS256)  │ JWT (RS256)
                       hosted UI /  │              │  device grant
                       custom login │              │  (RFC 8628)
                                    ▼              ▼
                        ┌───────────────────┐  ┌──────────────────────┐
                        │  Dashboard        │  │  Extension /          │
                        │  middleware.ts    │  │  capture agent        │
                        │  verifies JWT →    │  │  attaches verified    │
                        │  role from claims │  │  advisor_id = sub     │
                        └─────────┬─────────┘  └───────────┬──────────┘
                                  │                        │
                                  ▼                        ▼
                        ┌────────────────────────────────────────────┐
                        │  servicesync-advisors (DynamoDB)             │
                        │  now a PROFILE/MAPPING store:                │
                        │  cognito_sub → advisor_id, name, dealership, │
                        │  station, role                               │
                        └────────────────────────────────────────────┘
```

### 2.1 Identity provider: Cognito user pool
- One pool, `servicesync-users`. Sign-in with email (alias: preferred_username
  optional). MFA optional at pilot, `OPTIONAL` → tighten to `ON` for
  `owner`/`manager` later.
- **`custom:role`** — a custom attribute (string, mutable) holding `advisor` |
  `manager` | `owner`. Also mirror role membership as **Cognito groups** of the
  same names so we can use group-based policies and the `cognito:groups` claim.
  We read `custom:role` first, fall back to the first group (see
  `roleFromClaims`).
- Two **app clients**:
  1. **dashboard** — confidential-ish web client. Hosted UI or custom login,
     Authorization Code + PKCE, callback to `https://dashboard.servicesync.io/api/auth/callback`.
  2. **extension** — public client, no secret. **Device Authorization Grant +
     PKCE**. Refresh tokens enabled with a long rotation window (the capture
     agent is long-lived and headless).

### 2.2 Dashboard login options (pick one at cutover)
- **Option A — Cognito Hosted UI (recommended first):** least code. Login page
  redirects to the hosted UI; on success Cognito redirects back to
  `/api/auth/callback` with an authorization code; the callback exchanges it for
  tokens (PKCE) and sets httpOnly cookies (`ss_id`, `ss_refresh`). Fastest to
  ship, AWS-managed UI, supports MFA/forgot-password for free.
- **Option B — Custom login on the existing `/login` page:** keeps our
  Bloomberg-terminal look. Uses the Cognito `USER_PASSWORD_AUTH` /
  `USER_SRP_AUTH` flow via `@aws-sdk/client-cognito-identity-provider` in
  `/api/auth`. More code, more surface (we handle SRP / challenges / MFA),
  but on-brand. Recommendation: **A first**, migrate to **B** once stable.

Either way, **`middleware.ts` verification is identical** — it validates the JWT
in the `ss_id` cookie. That verification is already scaffolded (see §4).

### 2.3 Extension verified identity (design only)
The problem: today `advisor_id` is self-declared. We want it **asserted by
Cognito**.

Flow (OAuth 2.0 **Device Authorization Grant**, RFC 8628 — the right fit for a
headless/limited-input capture client):

1. On first run (or when refresh token is missing/expired) the extension calls
   Cognito's device-authorization endpoint (with PKCE) and gets a
   `user_code` + `verification_uri`.
2. The extension shows: *"Go to `https://auth.servicesync.io/device` and enter
   code `WXYZ-1234`."* The advisor does this **on the dashboard/browser** where
   they can authenticate normally (SSO with the dashboard session if present).
3. The extension polls the token endpoint until the user approves, then receives
   an **access token + refresh token**. It stores the refresh token in OS-native
   secure storage (Keychain / DPAPI), never in plaintext config.
4. From then on, every capture upload / API call carries the **verified access
   token**. The backend derives `advisor_id` from the token's `sub` (or a
   `custom:advisor_id` mapping), and **rejects** any client-supplied
   `advisor_id` that doesn't match. Self-registration is gone.
5. Token refresh happens silently via the refresh token; only a full
   expiry/revocation forces a new device authorization.

Backend enforcement point: the ingest Lambda / API Gateway authorizer validates
the JWT (same JWKS/`iss`/`aud` checks as the dashboard) and stamps the
server-verified `advisor_id`. The client can no longer spoof another advisor.

---

## 3. Migration plan

### 3.1 From shared password → Cognito (dashboard)
1. Stand up the pool (Terraform in `infra/auth.tf`, **not yet applied**).
2. Create users for Frazier (owner) + the pilot advisor(s) (advisor) + any
   manager. Set `custom:role` and group membership.
3. Deploy the dashboard with the callback route + hosted UI, but keep
   `AUTH_MODE` unset → password gate still live. Smoke-test Cognito on a
   preview/staging host with `AUTH_MODE=cognito`.
4. Flip production `AUTH_MODE=cognito`. Keep `DASHBOARD_PASSWORD` set for one
   rollback window; flipping the env back to `password` (or unset) instantly
   restores the shared-password gate. No redeploy needed to roll back.
5. After a stable window, remove `DASHBOARD_PASSWORD` from the host and delete
   the password branch in a later PR.

### 3.2 From shared PILOT01 code + self-registration → verified (extension)
1. **Interim (Stage 2, already happening):** replace shared `PILOT01` with
   **per-advisor access codes** stored against `servicesync-advisors`. Each
   client enrolls with its own code. This gives per-user attribution *before*
   Cognito and lets us retire clients one at a time.
2. Populate Cognito users and, for each advisor, write the mapping
   `cognito_sub → advisor_id` into `servicesync-advisors` (the table becomes a
   profile/mapping store, not a self-registration target).
3. Ship an extension build that supports the device grant **but still accepts
   the legacy access-code path** (dual-mode). Advisors are prompted to do the
   one-time device authorization at their convenience.
4. Once an advisor has completed device auth, their access code is revoked; the
   backend now requires a valid token for that `advisor_id`.
5. When all clients are migrated, drop the access-code path entirely.

### 3.3 servicesync-advisors table: role change, not removal
- **Before:** self-registration target; source of "who exists."
- **After:** profile + mapping store keyed by `cognito_sub`, holding
  `advisor_id`, `advisor_name`, `dealership`, `station`, `role`. Cognito owns
  authentication; the table owns the ServiceSync-specific profile + the
  `sub → advisor_id` mapping the dashboard's `lib/advisors.ts` already reads.
  `listAdvisors()` keeps working; it just gets its rows from an
  identity-verified population.

---

## 4. Dashboard JWT validation (what's scaffolded in this PR)

- `lib/auth/cognito-edge.ts` — Edge-safe verifier using **Web Crypto**
  (`crypto.subtle`), no new dependency, so `npm run build` is unchanged:
  - fetches + caches the pool **JWKS** (`/.well-known/jwks.json`),
  - verifies the **RS256** signature over `header.payload`,
  - checks `exp` / `iat` (with clock skew), `iss`, `token_use`, and audience
    (`aud` for id tokens, `client_id` for access tokens),
  - returns claims (incl. `custom:role`, `cognito:groups`) or `null`.
- `middleware.ts` — reads `AUTH_MODE`:
  - **unset / `password`** → original shared-password gate, **byte-for-byte
    unchanged** (default).
  - **`cognito`** → validates the JWT from the `ss_id` cookie (or `Authorization`
    header), optional coarse RBAC via `COGNITO_REQUIRED_ROLES`, forwards
    `x-ss-user` / `x-ss-role` to downstream handlers. **Never active unless the
    env is set and the pool exists** (fails closed if `AUTH_MODE=cognito` but no
    pool is configured).

### Env vars that activate the Cognito path (none set today)
| Var | Purpose |
|-----|---------|
| `AUTH_MODE` | `cognito` to enable; unset/`password` = default gate |
| `COGNITO_REGION` | pool region (falls back to `AWS_REGION`) |
| `COGNITO_USER_POOL_ID` | e.g. `us-east-1_xxxxxxxxx` |
| `COGNITO_CLIENT_ID` | dashboard app client id |
| `COGNITO_TOKEN_USE` | `id` (default) or `access` |
| `COGNITO_CLOCK_TOLERANCE` | skew seconds (default 60) |
| `COGNITO_REQUIRED_ROLES` | optional CSV app-wide role gate |

### Still to build before cutover (NOT in this PR)
- `/api/auth/callback` route (hosted-UI code→token exchange, PKCE, set cookies).
- Refresh handling: a Node route that uses the `ss_refresh` cookie to mint a new
  `ss_id` when it nears expiry (middleware can 401→refresh→retry, or a client
  interceptor refreshes proactively).
- Logout: revoke tokens at Cognito + clear cookies.
- Login page redirect (Option A) or SRP flow (Option B).
- Hardening: consider swapping the hand-rolled verifier for `aws-jwt-verify`
  once a dependency add is acceptable.

---

## 5. Session & refresh handling
- **Cookies:** `ss_id` (id/access JWT, httpOnly, `secure` in prod, `sameSite=lax`,
  short TTL ~1h to match Cognito token life) and `ss_refresh` (refresh token,
  httpOnly, longer TTL). Never expose tokens to client JS.
- **Refresh:** access/id tokens are short-lived; the refresh token (default 30d,
  rotating) mints new ones. The dashboard refreshes server-side in the callback/
  refresh route. The extension refreshes silently via the token endpoint.
- **Revocation:** disabling a Cognito user or revoking their refresh token kills
  access at next refresh; short access-token TTL bounds the exposure window.
- **Compare to today:** the shared-password cookie is a static `sha256` value
  with a weekly TTL and no per-user revocation — Cognito gives real
  revocation + rotation.

---

## 6. Risks of the eventual cutover
1. **Lockout / self-inflicted DoS.** `AUTH_MODE=cognito` with a misconfigured
   pool fails closed → nobody can log in. Mitigation: staging smoke test; keep
   `DASHBOARD_PASSWORD` set for a rollback window; env flip (no redeploy) to roll
   back.
2. **Edge runtime constraints.** Middleware runs on Edge — no Node `crypto`, must
   use Web Crypto + `fetch` (done). A future dependency that pulls Node-only code
   into middleware would break the build.
3. **JWKS availability/latency.** First request per isolate fetches JWKS; cache
   it (done) and use `force-cache`. A Cognito JWKS outage blocks verification.
4. **Clock skew** between host and Cognito can reject valid tokens — tolerance is
   configurable (default 60s).
5. **Extension migration is the hard part.** A fleet of installed, headless
   clients must move without dropping capture. Dual-mode (access code + device
   grant) + per-client cutover is mandatory; a hard flip would silently stop
   data collection for un-migrated advisors.
6. **`advisor_id` remapping.** If `advisor_id` changes from the self-declared
   string to the Cognito `sub`, all historical S3 prefixes / DynamoDB keys use
   the old id. Keep the mapping in `servicesync-advisors` and keep the
   human-readable `advisor_id` (e.g. `siltaylor`) as the stable partition key;
   only the *authentication* changes, not the data layout.
7. **Cost/complexity.** Cognito is cheap at pilot scale but adds an AWS resource,
   hosted-UI domain/cert, and a callback surface to secure (open-redirect, state/
   PKCE validation).
8. **Role source of truth.** `custom:role` vs groups can drift — pick one as
   canonical (we read attribute-first) and set both together at user creation.

---

## 7. Rollout order (summary)
1. **Dashboard first** — one host, instant env rollback, low blast radius.
2. **Extension second** — staged, dual-mode, per-advisor device authorization,
   then retire access codes.
3. Remove the shared password + `PILOT01` shared code once both are fully
   migrated and stable.
