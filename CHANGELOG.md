# Changelog — Pilot Intelligence Dashboard

All notable changes to the `dashboard/` app. Scoped to this directory to keep
the PR self-contained.

## [Unreleased]

### Added
- **Stage 3 sign-in scaffold + design (non-deployed, default-off).** Additive and inert: with no new env vars set, the dashboard behaves exactly as today (shared-password gate). Nothing here is wired into a live deploy.
  - `docs/AUTH_DESIGN.md` — full design: AWS Cognito user pool with per-user logins + a `role` custom attribute (`advisor`/`manager`/`owner`), hosted-UI vs custom login, JWT validation in `middleware.ts`; extension OAuth 2.0 device-authorization + PKCE flow so `advisor_id` becomes *verified* (not self-declared); migration from the shared password + shared `PILOT01` code (`servicesync-advisors` + per-user access codes as interim Stage 2 identity); session/refresh handling; dashboard-first / extension-second rollout; cutover risks.
  - `infra/auth.tf` — Terraform for the Cognito user pool + `advisor`/`manager`/`owner` groups + a `role`/`advisor_id` custom attribute + dashboard (Auth Code + PKCE) and extension (device-grant) app clients + hosted-UI domain. **Clearly headed "NOT APPLIED — review before terraform apply"**; deliberately no `provider`/backend so a stray apply cannot succeed.
  - `middleware.ts` — new `AUTH_MODE` env switch, **default off**: unset/`password` runs the original shared-password gate byte-for-byte; `cognito` validates a Cognito JWT (JWKS/RS256, `iss`/`aud`/`exp`/`token_use`, optional role gate). The Cognito branch is never active unless `AUTH_MODE=cognito` and a pool is configured; it fails closed if mode is on but no pool exists.
  - `lib/auth/cognito-edge.ts` — Edge-safe Cognito JWT verifier using the Web Crypto API only (no new dependency, so `npm run build` is unchanged). Scaffolding — invoked only by the Cognito branch.
- **Usage & Cost** (`/intel/usage`) — a per-advisor view of assistant usage and spend. Reads the `servicesync-assistant-usage` DynamoDB table (name from `TABLE_ASSISTANT_USAGE`, PK `advisor_id` / SK `date`), aggregating the last ~30 days into per-advisor messages, in/out tokens, and dollars (today + 30d) with a real-advisor total. Owner/testing traffic (ids starting with `test` or equal to `frazier-testing`) is bucketed separately so it never inflates the totals. Handles both row shapes gracefully: `msg_count` is always present, while `in_tokens`/`out_tokens`/`cost_usd` may be absent on older rows (default to 0). When no row carries cost data yet it degrades to a messages-only view with a "metering populates once the metering backend is deployed" note. The page prominently notes that Recovery + Audit model costs are owner-side (not attributable per advisor) and tracked separately.
  - `lib/usage.ts` — `getUsageReport()` scans (paginated, bounded to the 30-day window via a `date >= cutoff` filter) using the shared doc client from `lib/tracker/dynamo.ts`; `isTestingAdvisor()` splits the owner/test bucket.
  - `app/api/intel/usage/route.ts` — `GET` returning `UsageReport` (Node runtime, force-dynamic, intel-style `Cache-Control`, try/catch → 500).
  - `app/intel/usage/page.tsx` — server component: per-advisor table (advisor · messages · in/out tokens · $ today · $ 30d), a total, the Testing bucket shown separately, and a graceful "unavailable" card if the table read fails (mirrors the Recovery page pattern).
  - `components/Sidebar.tsx` — "Usage & Cost" nav item (💰) after Recovery.
  - **Deploy note:** the dashboard's AWS identity needs `dynamodb:Query` + `dynamodb:GetItem` (Scan) on the `servicesync-assistant-usage` table.
- **Multi-advisor foundation** — the dashboard is no longer hardwired to a single advisor. Additive and non-breaking: everything still defaults to `siltaylor` when no advisor is selected.
  - `lib/advisors.ts` — `listAdvisors()` reads the new `servicesync-advisors` DynamoDB table (name from `TABLE_ADVISORS`, reusing the shared doc client from `lib/tracker/dynamo.ts`), returning `{ advisorId, advisorName, dealership }[]`; falls back to the single `config.advisorId` when the table is empty/unavailable. `resolveAdvisorId(explicit?)` resolves a selection to a valid id or the configured default.
  - `app/api/intel/advisors/route.ts` — `GET` returning the advisor directory (Node runtime, force-dynamic, intel-style `Cache-Control`).
  - `components/AdvisorSelector.tsx` — dark-theme `<select>` in the sidebar; on change it sets the `ss_advisor` cookie (path=/) and `router.refresh()`es the server components.
  - **Recovery is now advisor-aware** (reference wiring): `app/intel/recovery/page.tsx` and the recovery API read the `ss_advisor` cookie and pass the advisor into `getRecovery(advisorId?)`. `lib/recovery.ts` now scopes transcript loading via `transcriptsPrefixForAdvisor()` (best-effort — all transcripts live under one prefix today, so behavior is unchanged) and keys its in-memory cache per advisor so switching never serves another advisor's result.
  - `TODO(multi-advisor)` markers left in the Overview / Audio / Activity / Insights loaders (`app/intel/page.tsx`, `app/api/intel/audio/list/route.ts`, `app/intel/insights/page.tsx`, `lib/events.ts`) where they'd honor the selection — tracked as follow-ups.
- **Declined Work Recovery** (`/intel/recovery`) — the flagship product signal. A Claude (Bedrock, Sonnet 5) pass over the most recent transcripts extracts declined/deferred work as structured items: recommended job, estimated $ value, urgency (safety/maintenance/cosmetic), whether a follow-up was logged, and a verbatim quote. A "Recoverable" hero sums the dollars on items with no logged follow-up — the recovery opportunity. Items sorted safety-first then by value.
  - `lib/bedrock.ts` — IAM-native Bedrock client (`invokeClaude`) + tolerant JSON extraction. Models: Haiku/Sonnet 5/Opus profiles.
  - `lib/recovery.ts` — robust transcript-text reader (handles the Whisper flat `{transcript}` shape **and** AWS Transcribe JSON), the detection prompt, and a 30-min in-memory result cache so refreshes don't re-bill the model.
  - `app/api/intel/recovery/route.ts` — `GET` (with `?refresh=1`) returning `RecoveryResult`.
  - `app/intel/recovery/page.tsx` + Sidebar "Recovery" tab.
  - `magenta` (+ `violet`) brand token added to `tailwind.config.ts` (closes the missing-magenta gap in the brand spec).
  - **Deploy note:** adds the `@aws-sdk/client-bedrock-runtime` dependency (run `npm install` on deploy), and the dashboard's AWS identity needs `bedrock:InvokeModel` on the Claude inference profiles.
- New dependency: `@aws-sdk/client-bedrock-runtime`.

### Fixed
- **Transcript parsing for the live Whisper shape.** `parseTranscript` (`lib/transcribe.ts`) only understood AWS Transcribe JSON (`results.audio_segments`/`items`/`transcripts`), but the live pilot transcripts in S3 are the flat Whisper Lambda output (`{ transcript, word_count, ... }`). On real data it produced empty/garbage output, breaking the Audio tab's transcript viewer and the Insights keyword scan. It now detects the Whisper flat shape first (string `transcript`, no `results`) and builds a `Transcript` from it — full text, `word_count` (or computed), `duration_sec`/`duration` if present else 0, and readable sentence/~25-word segments with zero timestamps. All AWS Transcribe paths are kept intact as fallbacks. `TranscriptViewer` now only wires click-to-seek + active-line highlighting when a segment has a real end timestamp, so zero-timestamp Whisper segments render as plain readable lines.
- `CLAUDE.md` rewritten — it described a pre-build Supabase/n8n/Vercel plan that never shipped; the app is a built Next.js 14 + AWS (S3/Transcribe/DynamoDB/Bedrock) dashboard.

## [0.1.0] — 2026-06-19

### Added
- Initial Next.js 14 (App Router) + Tailwind dashboard scaffold.
- **Overview** page: PC/audio/extension health, storage + volume stats, recent
  activity feed (server-rendered from S3).
- **Audio** page: recording list, in-browser streaming player (presigned S3),
  transcript viewer with click-to-seek + in-transcript search, one-click AWS
  Transcribe.
- **Activity** page: 24h session timeline, time-per-system chart, context-switch
  heatmap, session list with rapid-switch friction flags.
- **Insights** page: daily summary, top friction patterns, transcript keyword
  highlights, heuristic recommendations, dealer-ready audit preview.
- **Live** page: 30s-polling health + SSH quick actions over Tailscale.
- API routes: audio list/stream, transcripts list/[id], events, events/summary,
  status, transcribe, live/action, auth.
- `lib/`: S3 helpers, AWS Transcribe helpers, pure analysis/aggregation, SSH
  helpers, formatting utils, shared types.
- Password gate via middleware + httpOnly cookie.
- ServiceSync branding: dark mode, Space Grotesk / Inter, cyan/blue accents.

### Security
- S3 access is read-only; presigned URLs for audio playback (no creds exposed).
- `/api/live/action` runs only a fixed allow-list of remote commands — never
  arbitrary client input.
- Pinned Next.js to 14.2.35 (patched; avoids the 14.2.5 advisory).
