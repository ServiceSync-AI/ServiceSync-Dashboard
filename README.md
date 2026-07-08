# ServiceSync — Pilot Intelligence Dashboard

Internal founder tool ("mission control") for monitoring, exploring, and
analyzing everything captured from the **Chevyland Chevrolet** pilot
(Shreveport, LA — advisor `siltaylor`). Not customer-facing.

Bloomberg-terminal-meets-Vercel: dark, dense, fast. Reads directly from S3 —
no database in v1.

---

## What it shows

| Page | Route | What |
|------|-------|------|
| **Overview** | `/` | System health (PC online, capture running, extension active) + storage/volume stats + recent activity feed |
| **Audio** | `/audio` | Recording list, in-browser player (streamed from S3), transcript viewer with click-to-seek, full-text search within a transcript, one-click AWS Transcribe |
| **Activity** | `/activity` | 24h session timeline, time-per-system chart, context-switch heatmap, session list, rapid-switch friction flags |
| **Insights** | `/insights` | Daily summary, top friction patterns, transcript keyword highlights, recommendations, dealer-ready audit preview |
| **Recovery** | `/intel/recovery` | **Declined Work Recovery** — Claude (Bedrock) pass over recent transcripts: declined/deferred jobs, estimated $ on the table, follow-up-logged flag, customer's own words |
| **Live** | `/live` | 30s-polling health, SSH quick actions (ffmpeg/disk/latest-audio/Chrome), trigger transcript for latest file |

---

## Data sources

| Data | Location |
|------|----------|
| Audio (MP3, 30-min chunks) | `s3://servicesync-dealership-audio/siltaylor/` |
| Transcripts (AWS Transcribe JSON) | `s3://servicesync-dealership-audio/transcripts/` |
| Browser events (gzipped JSONL) | `s3://servicesync-advisor-data/raw-events/chevyland_chevrolet/` |
| Live PC (Tailscale) | `ssh sil@100.104.185.115` |

---

## Stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind**
- **AWS SDK v3** — S3 (read-only) + Transcribe
- **Recharts** for the usage chart
- Deployed to **Vercel**

All S3 access is **read-only** — the dashboard never mutates the pilot buckets.
The only write-side action is starting AWS Transcribe jobs.

---

## Local setup

```bash
cd dashboard
cp .env.local.example .env.local   # fill in AWS creds + DASHBOARD_PASSWORD
npm install
npm run dev                        # http://localhost:3000
```

### Environment variables

See `.env.local.example`. Key ones:

| Var | Purpose |
|-----|---------|
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` | Read access to the two buckets + Transcribe |
| `AUDIO_BUCKET` / `EVENTS_BUCKET` | Bucket names |
| `AUDIO_PREFIX` / `TRANSCRIPTS_PREFIX` / `EVENTS_PREFIX` | Key prefixes (defaults match the pilot) |
| `DEALER_PC_IP` / `SSH_USER` / `SSH_KEY_PATH` | Live-page SSH actions over Tailscale |
| `DASHBOARD_PASSWORD` | Single shared password for the gate |

---

## Auth

A single shared password (`DASHBOARD_PASSWORD`). `middleware.ts` redirects any
unauthenticated request to `/login`; `/api/auth` sets an httpOnly cookie holding
`sha256(password)`. If `DASHBOARD_PASSWORD` is unset, the gate fails open (dev
convenience) — **always set it in production.**

---

## API routes

| Method + Route | Returns |
|----------------|---------|
| `GET /api/audio/list` | `AudioFile[]` (with `hasTranscript`) |
| `GET /api/audio/stream?key=` | 302 → presigned S3 URL (range/seek works) |
| `GET /api/transcripts/list` | `TranscriptListEntry[]` |
| `GET /api/transcripts/[id]` | `Transcript` (`id` = base64url of the S3 key) |
| `GET /api/events?date=YYYY-MM-DD` | `BrowserEvent[]` for that UTC day |
| `GET /api/events/summary?days=N` | `EventsSummary` (capped at 30 days) |
| `GET /api/status` | `SystemStatus` (TCP ping + S3 freshness) |
| `POST /api/transcribe` `{audioKey}` | `{jobName, status}` (`GET ?job=` polls) |
| `POST /api/live/action` `{action}` | `{ok, stdout, stderr}` (fixed allow-list only) |
| `POST/DELETE /api/auth` | set / clear the auth cookie |

---

## How analysis works

`lib/analyze.ts` is pure (events in → derived data out), so it runs in both API
routes and client components:

- **System classification** — maps each event to ASR Pro / Global Connect /
  ProDemand / DMS / Other / Distraction from the `system` field or URL/title.
- **Sessions** — splits the stream on idle gaps > 5 min.
- **Friction** — rapid-switch bursts (3+ systems in < 2 min), high switch rate,
  ProDemand lookups, distraction time, idle.
- **Transcript highlights** — keyword scan for complaints, hold time, declined
  work, advisor frustration, upsells.

> Insights are **heuristic decision-support**, clearly labeled as such — not a
> model verdict.

---

## Deploy (Vercel)

1. Connect the repo, set **root directory** to `dashboard/`.
2. Add all env vars from `.env.local.example`.
3. Domain: `intel.servicesync.ai` (or `pilot.servicesync.ai`).

⚠️ **SSH quick actions on `/live` require the deploy private key on the host.**
Vercel's serverless filesystem won't have your `~/.ssh` key, and Tailscale isn't
reachable from Vercel — so the live SSH actions are intended for **local /
self-hosted** runs. On Vercel, the read-only S3 pages all work; the SSH actions
will report unreachable.

---

## Known limitations / follow-ups

- **Cross-transcript search** — transcript search is currently within a single
  selected transcript. A bucket-wide full-text search is a follow-up (would need
  an index or on-demand fan-out fetch).
- **Summary window anchoring** — `/api/events/summary` uses a now-based window;
  if capture pauses, widen `days` to see older data.
- **RO-level metrics** — RO counts/timing in the audit preview are derived from
  activity signals, not a DMS integration yet.
