# ServiceSync — Pilot Intelligence Dashboard

## What This Is
Internal founder "mission control" for the Chevyland Chevrolet pilot (advisor `siltaylor`). Monitors, explores, and analyzes everything captured from the pilot — browser events, desk-mic audio + transcripts, and the customer tracker. Not customer-facing. Dark, dense, Bloomberg-terminal aesthetic.

## Stack (actual — built and deployed)
- Next.js 14 (App Router), TypeScript, Tailwind CSS, Recharts
- AWS SDK v3: S3 (events + audio + transcripts), Transcribe, DynamoDB (tracker), **Bedrock (Claude)** for analysis
- **No Supabase, no n8n, no Vercel.** Reads directly from S3/DynamoDB; standardized on the all-AWS stack.
- Deployed on **EC2** (`servicesync-dashboard`, pm2 process `pilot-dashboard`) behind a Cloudflare tunnel at `dashboard.servicesync.io`. Branch `master`. Deploy: `git pull && npm install && npm run build && pm2 restart pilot-dashboard --update-env`.

## Pages (`app/`)
- `/intel` Overview · `/intel/audio` Audio+transcripts · `/intel/activity` timeline · `/intel/insights` heuristic summary · `/intel/recovery` **Declined Work Recovery (Bedrock)** · `/intel/live` remote actions · `/console` repair board · `/tracker` customer status

## Key libs (`lib/`)
- `config.ts` — env-derived buckets/prefixes (`audioBucket`, `eventsBucket`, prefixes). Single source of truth.
- `s3.ts` — read-only S3 helpers (`listAll`, `getObjectText`, `getGzippedText`, `presignGet`).
- `events.ts` — gzipped JSONL browser-event loading; `analyze.ts` — heuristic summaries/friction/highlights.
- `transcribe.ts` — transcript parsing; `recovery.ts` + `bedrock.ts` — Claude-powered declined-work detection.
- `tracker/dynamo.ts` — DynamoDB reads/writes for the customer tracker + console.

## Env Vars
- `DASHBOARD_PASSWORD` (**required in prod** — middleware fails closed if unset), `AWS_REGION`, optional `AUDIO_BUCKET`/`EVENTS_BUCKET`/prefix overrides. AWS creds via the instance role/profile.

## Rules
- Read-only against the pilot buckets. Never mutate captured data.
- The dashboard's AWS identity needs `bedrock:InvokeModel` (Claude profiles) for the Recovery page.
- Don't commit secrets. Follow repo `AGENTS.md`/conventions (branch → PR → master).
