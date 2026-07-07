# Changelog — Pilot Intelligence Dashboard

All notable changes to the `dashboard/` app. Scoped to this directory to keep
the PR self-contained.

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
