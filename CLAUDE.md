# ServiceSync AI — Dashboard (Command Center)

## What This Is
Real-time service manager dashboard for visualizing operational "friction" in auto dealership service departments. Live friction feed, heatmap, advisor productivity, AI insights.

## Stack (Planned)
- Next.js 14, TypeScript, Tailwind CSS, Recharts
- Supabase real-time subscriptions
- n8n intelligence engine feeds data
- Vercel deployment

## Current State
PRE-BUILD. This is a planning/spec document only — nothing is built yet. All Phase 1/2/3 tasks unchecked.

## Expected Supabase Tables
friction_events, beacon_locations, transcription_results, advisor_metrics, ai_insights

## Env Vars
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY

## Don't
- Don't start building without confirming Supabase schema matches Data Pipeline output
- Don't commit secrets
