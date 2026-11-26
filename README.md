# CampusFest 2026 Growth Center

Attendee-growth command center for a college festival in Bengaluru (Challenge A): analytics dashboard, campaign diagnosis, execution tracker and an AI growth analyst.

Live app: https://campus-fest-risa-hiring.vercel.app/

## Strategy and research

> **To complete:** author name, why Bengaluru, target audiences and sizes, the five ranked ideas, prioritization framework, test plans, and sources (separate sourced facts from assumptions).

## What the product does

| Area | Features |
|---|---|
| Dashboard | Funnel, campaign KPIs, targets vs projections, budget vs spend, venue capacity check |
| Diagnosis | Campaign status, bottleneck flags, 7-day comparison, scale / keep / change / stop decision |
| Execution | Manage campaigns, tasks and daily metrics, saved to Supabase |
| AI analyst | Gemini with function calling over Supabase data; proposes tasks that are saved only after confirmation |

## Calculations

All "days" are relative to `settings.as_of_date`. Enabler campaigns have no attendee projection.

| Metric | Formula |
|---|---|
| Projected attendees (campaign) | (registrations to date + last-7-day average daily registrations x days remaining) x assumed show-up |
| Total projected attendees | Sum of acquisition campaign projections + walk-in allowance |
| Net confirmed | confirmed - cancelled (shown separately, not part of the projection) |
| Expected attendees to date | registrations x assumed show-up |
| Cost per expected attendee to date | spend / expected attendees to date. The overall figure includes enabler spend |
| Identified-to-registered | registrations / identified |
| Cancel rate | cancelled / confirmed |
| Minimum days needed | projected attendees / venue capacity per day, rounded up |

The chart plots cumulative registrations against the sum of acquisition campaigns' registration targets.

## Status, flags and decisions

Status by projected % of attendee target: **On track** 90% or more, **At risk** 60% to under 90%, **Underperforming** under 60%, **Planned** if no metrics.

Bottleneck flags:
- Identified-to-registered more than 25% below the campaign average
- Last-7-day cancel rate more than 25% above the average
- Last-7-day cancel rate more than 2x the earlier rate
- Registrations down more than 30% week on week (previous week of at least 15)

Decisions, checked in this order. "Average" is active acquisition spend / expected attendees (excludes enablers).

| Decision | Rule |
|---|---|
| Stop | Under 60% of target, and cost over 1.25x average or spend with no expected attendees |
| Change | Otherwise under 90% of target, or any bottleneck flag |
| Scale | 90% or more, no flags, cost at or below average, budget left |
| Keep | Everything else |

Thresholds are judgment calls, not derived from a statistical test. Edit `DECISION_RULES` in `src/lib/analytics.ts`.

## Assumptions

- Assumed show-up rates are stored per campaign; the analyst describes them as 2025 registered-to-attended rates.
- Recent registration pace continues until the event.
- Budget-move simulation uses 2025 cost per attendee and assumes added spend is half as efficient. It is a rough estimate, not a forecast.

## Data

Stored in Supabase.
- Current campaign: `settings`, `campaigns`, `daily_metrics`, `tasks`
- 2025 historical data: `orig_campaigns`, `orig_daily_marketing`, `orig_people`, `orig_registrations`, `orig_reg_history`, `orig_checkins`, `orig_interactions`, `orig_targets`

> **To complete:** which values come from the provided dataset and which are simulated.

## Setup

Needs Node.js and Bun.

```bash
bun install
cp .env.example .env    # set GEMINI_API_KEY
bun run dev             # http://localhost:3000
bun run lint
bun run build
```

The Supabase project URL and publishable key are in `src/config/supabase.ts`.

On Vercel, set `GEMINI_API_KEY` as an environment variable. Chat routes are in `api/`; local development uses `server.ts`.

## Tools

React, TypeScript, Vite, Tailwind CSS, Express (local), Vercel Functions, Supabase, Google Gemini (`@google/genai`). Project started from the Google AI Studio template.

> **To complete:** plans used, other AI tools, and what you reused, modified and verified.

## Known limitations

- Cancellations do not reduce projected attendees.
- Capacity check does not model how attendees split across days.
- The app has no login, and `/api/chat` has no rate limit.
- The chat server accepts a Supabase URL and key sent by the browser.
- No automated tests.
