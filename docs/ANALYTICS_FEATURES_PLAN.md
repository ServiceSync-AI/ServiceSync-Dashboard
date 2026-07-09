# ServiceSync Analytics Features — Execution Plan

**Created:** 2026-07-09  
**Status:** Planning (not yet implemented)  
**Dashboard:** Next.js 14, Tailwind, dark Bloomberg theme  
**AWS Account:** 101257774391, us-east-1  
**Pilot Advisor:** siltaylor-chevyland (1 active)

---

## Table of Contents

1. [Weekly Pilot Report](#1-weekly-pilot-report)
2. [Revenue Recovered Tracker](#2-revenue-recovered-tracker)
3. [Advisor Scorecard](#3-advisor-scorecard)
4. [Before/After Comparison](#4-beforeafter-comparison)
5. [Cost-per-Insight Tracker](#5-cost-per-insight-tracker)
6. [Extension Uptime Monitor](#6-extension-uptime-monitor)
7. [Implementation Order](#implementation-order)
8. [Shared Infrastructure](#shared-infrastructure)

---

## 1. Weekly Pilot Report

**Goal:** Auto-generated summary email every Sunday + viewable dashboard page.

### Data Flow

```
EventBridge (cron: Sun 8PM ET)
  → Lambda (servicesync-weekly-report)
    → reads S3 events, DynamoDB usage/recovery tables, Cost Explorer
    → generates HTML email + JSON report
    → writes JSON to S3 (servicesync-advisor-data/reports/weekly/YYYY-MM-DD.json)
    → sends HTML via SES to frazier@servicesync.io
Dashboard /intel/report page
  → reads latest report JSON from S3 (or generates on-demand)
```

### Aggregated Metrics

- Total browser events count (from S3 events via `loadEventsInRange`)
- Active hours (from `summarize()` in lib/analyze.ts)
- Declined work $ total (from `getRecovery()`)
- Assistant query count (from DynamoDB `servicesync-assistant-usage`)
- Top 3 friction patterns (from `detectFriction()`)
- Context switches/hr average
- Extension uptime % (new calculation — see Feature 6)

### Files to Create

| Path | Purpose |
|------|---------|
| `lib/report.ts` | Report generation logic: aggregates all metrics for a week, produces JSON + HTML |
| `lib/ses.ts` | SES email helper (send HTML email, verify identity) |
| `app/intel/report/page.tsx` | Dashboard page rendering the latest (or selected) weekly report |
| `app/api/intel/report/route.ts` | API route: GET returns latest report, POST triggers regeneration |
| `infra/weekly-report-lambda/` | Lambda code (can reuse lib/ via bundling or a standalone Node script) |

### Files to Modify

| Path | Change |
|------|--------|
| `components/Sidebar.tsx` | Add nav item: `{ href: '/intel/report', label: 'Report', icon: '📋' }` |
| `lib/config.ts` | Add `reportPrefix` for S3 report storage path |

### AWS Resources Needed

| Resource | Config |
|----------|--------|
| **SES** | Verify `frazier@servicesync.io` as sender + recipient (sandbox). Domain verification for `servicesync.io` preferred. |
| **EventBridge Rule** | `cron(0 0 1 ? * MON *)` — Sunday 8PM ET = Monday 00:00 UTC. Target: Lambda. |
| **Lambda** | `servicesync-weekly-report` — Node 20, 512MB, 60s timeout. IAM: S3 read, DynamoDB read, SES send, Cost Explorer read. |
| **S3** | Prefix `reports/weekly/` in `servicesync-advisor-data` bucket. |

### Estimated Complexity

**Medium-High** — Involves new Lambda, SES setup, EventBridge rule, HTML email template, and a new dashboard page. The data aggregation logic mostly reuses existing lib functions. SES verification is the main ops hurdle.

---

## 2. Revenue Recovered Tracker

**Goal:** Track declined work from detection → follow-up → outcome (recovered/lost).

### Data Flow

```
Recovery page detects declined work (existing)
  → Items shown with "Mark as Recovered" / "Mark as Lost" buttons
  → PATCH /api/intel/recovery/outreach → updates status in DynamoDB
Dashboard section (on /intel/recovery page)
  → Queries outreach table with status filter
  → Displays: found $ | recovered $ | lost $ | pending $
```

### Schema Change (servicesync-recovery-outreach table)

**Current attributes:** `advisor_id (PK)`, `ts (SK)`, `status` (drafted|sent|failed), `declined_item`, `vehicle`, `customer`, `est_dollars`, `urgency`, `transcript_id`, `draft_text`, `phone`, `send_reason`

**Add:**
- `recovery_status`: `'pending' | 'recovered' | 'lost'` (default: `'pending'`)
- `recovery_updated_at`: ISO timestamp of when status was changed
- `recovery_notes`: optional free-text note (why it was recovered / lost)
- `recovered_amount`: actual $ recovered (may differ from `est_dollars`)

### Files to Create

| Path | Purpose |
|------|---------|
| `components/RecoveryStatusButton.tsx` | Client component: "Mark Recovered" / "Mark Lost" with modal for notes/amount |
| `components/RecoveryTotals.tsx` | Summary card: found $ / recovered $ / lost $ / pending $ with percentages |

### Files to Modify

| Path | Change |
|------|--------|
| `app/api/intel/recovery/outreach/route.ts` | Add PATCH handler to update `recovery_status`, `recovery_updated_at`, `recovery_notes`, `recovered_amount` |
| `lib/outreach.ts` | Add `updateRecoveryStatus()` function, update `OutreachRecord` type with new fields |
| `app/intel/recovery/page.tsx` | Add RecoveryTotals card at top, add status buttons per outreach row |
| `lib/types.ts` | Add `RecoveryStatus` type |

### AWS Resources Needed

| Resource | Config |
|----------|--------|
| **DynamoDB** | No table changes needed — new attributes are schemaless. Just write them. |

### Estimated Complexity

**Low-Medium** — The table already exists, just adding attributes. Main work is the UI components (status buttons, totals card) and the PATCH endpoint. No new infra.

---

## 3. Advisor Scorecard

**Goal:** Daily 0-100 productivity/engagement score per advisor with trend sparklines.

### Scoring Algorithm (proposed)

```
Score = weighted sum, capped at 100:
  - Active hours (30%): 8h+ = full marks, linear scale down
  - Context efficiency (25%): fewer switches/hr = better (target: <8/hr = full marks)
  - Assistant engagement (20%): using assistant = good (target: 3+ queries/day = full marks)
  - Friction avoidance (15%): fewer friction bursts = better (0 = full marks, -5 per burst)
  - Consistency bonus (10%): showing up every business day in the window
```

### Data Flow

```
Nightly Lambda (servicesync-audit — extend existing)
  OR new EventBridge → Lambda at 11PM ET
  → Reads day's events from S3 (loadEventsForDay)
  → Reads day's assistant usage from DynamoDB
  → Computes score + breakdown
  → Writes to DynamoDB: servicesync-advisor-scores table (new)

Dashboard /intel/scorecard page
  → Queries scores for last 30 days
  → Renders current score, breakdown, sparkline trend
```

### Files to Create

| Path | Purpose |
|------|---------|
| `lib/scorecard.ts` | Score computation logic (pure function: events + usage → score + breakdown) |
| `app/intel/scorecard/page.tsx` | Scorecard page: big score number, breakdown bars, 30-day sparkline |
| `app/api/intel/scorecard/route.ts` | GET: returns scores for advisor + date range |
| `components/ScoreSparkline.tsx` | SVG sparkline component (inline, no chart lib needed) |
| `components/ScoreBreakdown.tsx` | Horizontal bar breakdown of score components |

### Files to Modify

| Path | Change |
|------|--------|
| `components/Sidebar.tsx` | Add nav item: `{ href: '/intel/scorecard', label: 'Scorecard', icon: '🏆' }` |

### AWS Resources Needed

| Resource | Config |
|----------|--------|
| **DynamoDB Table** | `servicesync-advisor-scores` — PK: `advisor_id` (S), SK: `date` (S, YYYY-MM-DD). Attrs: `score`, `breakdown` (map), `computed_at`. |
| **Lambda** (option A) | Extend `servicesync-audit` to also compute and write scores after the nightly audit. |
| **Lambda** (option B) | New `servicesync-scorecard` Lambda on EventBridge cron, runs daily at 11PM ET. |

**Recommendation:** Option A (extend existing audit Lambda) — it already reads the day's events. Add score computation as a post-step.

### Estimated Complexity

**Medium** — New DynamoDB table, scoring algorithm to tune, sparkline component. The nightly compute can piggyback on the existing audit Lambda. Page is straightforward.

---

## 4. Before/After Comparison

**Goal:** Compare any two date ranges side-by-side for week-over-week progress tracking.

### Data Flow

```
User selects two date ranges on the page (or defaults: this week vs last week)
  → Client calls /api/intel/events/compare?start1=...&end1=...&start2=...&end2=...
  → Server loads events for both ranges via loadEventsInRange()
  → Runs summarize() on each
  → Also pulls declined work totals for each range
  → Returns both summaries + deltas

Page renders:
  - Two-column stat comparison
  - Delta arrows (↑ ↓) with color coding (green = improved)
  - Optional overlay chart
```

### Metrics Compared

| Metric | Better when... |
|--------|---------------|
| Active time | Higher |
| Switches/hr | Lower |
| Friction bursts | Lower |
| Systems used (breadth) | Neutral (context) |
| Declined work $ | Lower (fewer declines) |
| Assistant queries | Higher (engagement) |

### Files to Create

| Path | Purpose |
|------|---------|
| `app/intel/compare/page.tsx` | Comparison page with date-range pickers and two-column layout |
| `app/api/intel/compare/route.ts` | API: accepts two date ranges, returns both summaries + deltas |
| `components/CompareCard.tsx` | Two-value card with delta arrow and color |
| `components/DateRangePicker.tsx` | Client component: two date inputs with preset buttons (This Week / Last Week / Custom) |
| `lib/compare.ts` | Comparison logic: takes two EventsSummary objects, returns deltas + direction |

### Files to Modify

| Path | Change |
|------|--------|
| `components/Sidebar.tsx` | Add nav item: `{ href: '/intel/compare', label: 'Compare', icon: '⚖️' }` |

### AWS Resources Needed

**None** — All data already exists in S3 (events) and is loaded via existing `loadEventsInRange()`. No new tables or Lambdas needed. The API route is server-side only.

### Estimated Complexity

**Medium** — Main effort is the UI (date pickers, two-column layout, delta visualization). Backend is lightweight — just calling `summarize()` twice. The declined-work comparison requires calling `getRecovery()` with day-scoped ranges, which may need a small extension to support date ranges vs single days.

---

## 5. Cost-per-Insight Tracker

**Goal:** ROI metric showing AWS spend ÷ insights generated.

### Definition of "Insight"

An insight is any actionable output the system produces:
1. **Declined work item found** — count of `DeclinedItem` objects from recovery pass
2. **Audit findings** — count of flagged patterns in nightly audit (from S3 audit reports)
3. **Assistant answers** — count of messages from `servicesync-assistant-usage` table

### Data Flow

```
/intel/usage page (existing) — add a new section:
  → Reads this week's AWS spend (getCloudSpendMTD, prorated to weekly)
  → Counts insights:
    • Recovery items found this week (query outreach table or re-run recovery)
    • Audit findings this week (count from S3 audit JSONs)
    • Assistant messages this week (query usage table)
  → Computes: spend / total_insights = $/insight
  → Renders hero card: "$X spent → Y insights → $Z/insight"
```

### Files to Create

| Path | Purpose |
|------|---------|
| `lib/insights-count.ts` | Counts all "insights" for a given week: queries recovery table, audit S3, usage table |
| `components/CostPerInsightCard.tsx` | Hero card showing the spend → insights → $/insight flow |

### Files to Modify

| Path | Change |
|------|--------|
| `app/intel/usage/page.tsx` | Add CostPerInsightCard section between CloudSpendCard and the per-advisor table |
| `lib/awscost.ts` | Add `getWeeklySpendEstimate()` — takes MTD spend and prorates to current week, or queries Cost Explorer with weekly granularity |
| `lib/audits.ts` | Add `countAuditFindings(startDate, endDate)` — counts findings from S3 audit JSONs |

### AWS Resources Needed

**None new** — Reads from existing Cost Explorer, DynamoDB tables, and S3. May need to ensure the dashboard IAM role has read access to the S3 audit reports prefix.

### Estimated Complexity

**Low-Medium** — The hardest part is defining and counting "insights" consistently. The UI is a single card component. Cost data is already available. Main logic is in `lib/insights-count.ts`.

---

## 6. Extension Uptime Monitor

**Goal:** Track what % of business hours the extension is reporting, show gaps visually.

### Business Hours Definition

- Monday–Friday, 8:00 AM – 6:00 PM local (ET assumed for Chevyland)
- 10 hours/day × 5 days = 50 hours/week of expected coverage

### Uptime Calculation

```
For each business-hours slot (e.g., 15-minute buckets):
  - Check if any event exists with timestamp in that bucket
  - Bucket with events = "up"
  - Bucket without events = "gap"

Uptime % = (buckets with events / total business-hour buckets) × 100

Alert threshold: no events for >2 consecutive hours during business hours
```

### Data Flow

```
/intel page (overview) — add Uptime section:
  → Loads today's events (existing: loadEventsForDay)
  → Buckets into 15-min slots across 8AM-6PM
  → Calculates uptime % and gap zones
  → Renders: % badge + timeline bar (green = events, red = gaps)

Alert check (could be part of nightly audit or a separate check):
  → If current time is business hours AND last event > 2hr ago
  → Flag on dashboard (not email alert initially — add SES alert in Phase 2)
```

### Files to Create

| Path | Purpose |
|------|---------|
| `lib/uptime.ts` | Uptime calculation: takes events array + date → uptime %, gap list, timeline slots |
| `components/UptimeTimeline.tsx` | Visual timeline bar: green segments (active), red segments (gaps), time labels |
| `components/UptimeCard.tsx` | Summary card: uptime %, today's gaps count, alert state |
| `app/api/intel/uptime/route.ts` | API: returns uptime data for a given day or range |

### Files to Modify

| Path | Change |
|------|--------|
| `app/intel/page.tsx` | Add UptimeCard + UptimeTimeline to the overview page (after the Health row) |

### AWS Resources Needed

**None initially** — All computation happens from existing S3 events data. 

**Phase 2 (alerting):**
| Resource | Config |
|----------|--------|
| **EventBridge Rule** | `rate(30 minutes)` during business hours (or simpler: `cron(*/30 8-17 ? * MON-FRI *)`) |
| **Lambda** | `servicesync-uptime-check` — checks last event time, sends SES alert if >2hr gap |
| **SES** | Reuse the identity configured for weekly reports |

### Estimated Complexity

**Medium** — The timeline visualization is the most complex piece (responsive SVG/div bar with time labels and color-coded segments). The uptime calculation logic is straightforward. Alert Lambda is Phase 2.

---

## Implementation Order

Recommended build sequence (dependencies and value delivery):

| Phase | Feature | Why this order |
|-------|---------|----------------|
| **1** | Extension Uptime Monitor (#6) | Foundation metric, no new infra, immediate visibility |
| **2** | Revenue Recovered Tracker (#2) | Low complexity, completes existing recovery flow, immediate ROI signal |
| **3** | Cost-per-Insight Tracker (#5) | Builds on existing data, adds to existing page, quick win |
| **4** | Advisor Scorecard (#3) | New table needed, but scoring uses existing events data |
| **5** | Before/After Comparison (#4) | UI-heavy, leverages all the data from earlier features |
| **6** | Weekly Pilot Report (#6→#1) | Depends on SES setup + all metrics being in place. Best built last so it can aggregate everything. |

### Parallel Tracks

- **Track A (no-infra UI work):** Features 6, 2, 5, 4 can all be built without new AWS resources
- **Track B (AWS infra):** SES verification, new DynamoDB table, EventBridge + Lambda — needed for Features 1 and 3

Start Track A immediately. Kick off Track B (SES domain verification, DynamoDB table creation) early since verification can take time.

---

## Shared Infrastructure

### SES Setup (needed for Feature 1, Phase 2 of Feature 6)

```
1. Verify domain: servicesync.io (add DNS records)
2. Verify sender: noreply@servicesync.io or reports@servicesync.io
3. Verify recipient: frazier@servicesync.io (sandbox mode)
4. Request production access when ready for multi-recipient
```

### New DynamoDB Table (Feature 3)

```
Table: servicesync-advisor-scores
  PK: advisor_id (S)
  SK: date (S) — "YYYY-MM-DD"
  Attrs: score (N), breakdown (M), active_hours (N), switches_per_hr (N),
         friction_bursts (N), assistant_queries (N), computed_at (S)
  Billing: On-Demand (PAY_PER_REQUEST) — low volume at pilot scale
```

### New Sidebar Navigation (all features)

Updated `NAV_ITEMS` array:
```typescript
{ href: '/intel/report', label: 'Report', icon: '📋', description: 'Weekly pilot report' },
{ href: '/intel/scorecard', label: 'Scorecard', icon: '🏆', description: 'Daily score' },
{ href: '/intel/compare', label: 'Compare', icon: '⚖️', description: 'Period comparison' },
```

### Dashboard IAM Additions

The dashboard's AWS identity (Cognito-authenticated role) needs:
- `ses:SendEmail` (for Feature 1 if sending from dashboard directly vs Lambda)
- `dynamodb:PutItem` on `servicesync-advisor-scores` (for Feature 3 if computing in-app vs Lambda)
- No new S3 permissions needed (already has read on `servicesync-advisor-data`)

### Effort Estimates Summary

| Feature | New Files | Modified Files | New AWS Resources | Complexity |
|---------|-----------|----------------|-------------------|------------|
| 1. Weekly Report | 5 | 2 | SES, EventBridge, Lambda, S3 prefix | Medium-High |
| 2. Revenue Tracker | 2 | 4 | None (schema-only) | Low-Medium |
| 3. Advisor Scorecard | 5 | 1 | DynamoDB table, Lambda extension | Medium |
| 4. Before/After Compare | 5 | 1 | None | Medium |
| 5. Cost-per-Insight | 2 | 3 | None | Low-Medium |
| 6. Uptime Monitor | 4 | 1 | None (Phase 2: EventBridge + Lambda) | Medium |

**Total:** ~23 new files, ~12 modifications, 3-4 new AWS resources

### Estimated Timeline (solo developer)

- Features 6, 2, 5: 1-2 days each (UI + light backend)
- Features 3, 4: 2-3 days each (new page + logic)
- Feature 1: 3-4 days (Lambda, SES, email template, testing)
- **Total: ~2-3 weeks** at focused pace, including AWS setup time
