# CampusFest 2026 Growth Center

Attendee-growth command center for a college festival in Bengaluru (Challenge A): analytics dashboard, campaign diagnosis, execution tracker and an AI growth analyst.

## Prepared by: Ananya Mondal | 23CE10011 | IITKGP

- Live app: https://campus-fest-risa-hiring.vercel.app/
- Github Repo: https://github.com/Ani511/CampusFest-RISA-Hiring

## Strategy and research

### Why Bengaluru?

Bengaluru was selected as the proposed host city because it is a Tier 1 city with a dense college base and a strong student-event culture. Bengaluru Urban has 1,148 colleges, the most of any Indian district, according to [Zee News reporting on AISHE 2023-24](https://zeenews.india.com/education/50-districts-30-of-indias-colleges-the-hidden-geography-of-higher-education-3060810.html). The
growth plan therefore focuses on campus-led distribution, student
referrals, college partnerships and relevant student communities.

The city rationale is a qualitative strategic choice in this assessment.
The presentation does not quantify the addressable student population or
claim that any college has confirmed a partnership.

### Audience and growth opportunity

The plan uses the supplied CampusFest 2025 dataset as its historical
benchmark and sets two 2026 planning scenarios.

| Funnel stage | 2025 actual | 2026 base | 2026 stretch |
|---|---|---|---|
| Identified external people | 3,625 | 3,625 | 4,345 |
| Registrations | 2,800 | 2,800 | 3,356 |
| Registered attendees | 1,925 (68.75%) | 1,925 | 2,307 |
| Walk-ins | 125 | 125 | 125 |
| **Unique attendees** | **2,050** | **2,050** | **2,432** |

The stretch scenario targets 382 additional unique attendees, an 18.6%
increase over the base case. It assumes 2,307 registered attendees plus
125 walk-ins.

The base case retains the 2025 actual attendance level. The funnel table shows what the stretch target would need from acquisition alone, holding show-up at 68.75%, identified-to-registered at 77.2% and walk-ins at 125. The five growth bets below are a second route to the same total, combining new acquisition with a higher show-up rate. It is a planning scenario, not a guaranteed forecast.

### Historical channel benchmarks

The supplied synthetic 2025 dataset provides the following channel-level
attendee and spend-per-attendee benchmarks used to prioritise the 2026
plan.

| Audience source | 2025 attendees | Spend per attendee |
|---|---|---|
| Referrals | 275 | ₹69 |
| Organic search | 195 | ₹72 |
| College partnerships | 385 | ₹81 |
| Community groups | 165 | ₹97 |
| Ambassadors | 390 | ₹108 |
| Paid social | 340 | ₹274 |
| Creators | 175 | ₹337 |

Spend per attendee = channel spend / unique verified external attendees attributed to that channel. Walk-ins (125) are not attributed to any campaign.

The historical figures favour referrals, organic search and college
partnerships on attributed cost per attendee. Paid social and creator
activity were materially more expensive. The deck also uses historical
registered-to-attended rates of 78.6% for referrals, 85.6% for college
partnerships, and approximately 50% for paid social and creators.

These are historical attribution benchmarks from the assessment-provided
synthetic dataset. They are not causal estimates of incremental impact,
and should not be interpreted as guaranteed 2026 acquisition costs or
show-up rates.

### Budget scenarios

The stretch target of 2,432 unique attendees is estimated to require
₹70,000 above the 2025 marketing spend of ₹2,74,000, implying a total
budget of ₹3,44,000.

If the available budget is capped at ₹3,00,000, the plan proposes
reallocating ₹44,000 from paid social and creator spend towards the
higher-efficiency growth bets. Under the presentation's assumptions,
this produces approximately 2,283 unique attendees rather than the full
2,432 stretch target.

The reallocation estimate is a scenario calculation, not a validated
forecast. It depends on historical channel efficiency and the assumption
that additional spend is approximately half as efficient as the 2025
benchmark.

### Five ranked growth bets

The five initiatives are ranked by estimated incremental attendees per ₹1,000 of additional spend. For the four acquisition bets, the plan assumes added spend is half as efficient as the 2025 benchmark (cost per attendee doubles). The show-up booster is estimated separately.

| Rank | Growth idea | Budget | Gross extra attendees | Per ₹1,000 | Timeline | Test and primary KPI |
|---|---|---|---|---|---|---|
| 1 | Show-up booster: WhatsApp reconfirmation, QR pass and friend-group reminders | ₹10,000 | 91 | 9.1 | Days 1–21 | Holdout group; show-up from 68.75% to 72% |
| 2 | Referral squads: reward a referral when the friend attends | ₹15,000 | 109 | 7.3 | Days 1–14 | Cost per expected attendee |
| 3 | College club group passes | ₹25,000 | 154 | 6.2 | Days 1–14 | Pilot across three colleges; group confirmations |
| 4 | Community group takeovers with opt-out | ₹5,000 | 26 | 5.2 | Days 4–14 | Sign-up and opt-out rates |
| 5 | Ambassador campus sprints | ₹15,000 | 69 | 4.6 | Days 4–18 | Registrations per ambassador |
|  | **Total** | **₹70,000** | **449 gross** |  |  |  |

## Chatbot test log

The analyst was tested on live data, changed data, missing data and a false premise. Problems found during testing and how they were fixed are listed with the results. Figures are from the seeded data as of 21 Mar 2026.

| Test | What the analyst did | Result |
|---|---|---|
| "How are we pacing toward the base and stretch targets?" | Called `get_overall_funnel` | 2,166 projected = 2,041 from campaigns + 125 walk-ins; 105.7% of base and 89.1% of stretch. First version invented a "593" component; fixed by returning the projection components from the tool and adding a rule not to invent intermediate numbers. |
| "Which campaign is worst and why?" then "And vs last week?" | Used diagnosis and campaign metrics | Creator Partners, 64.3% of target. It named the 50% assumed show-up as the main driver, then compared registrations (44 to 36) and cancel rate week on week. |
| "What was our 2025 cost per attendee by campaign?" | Queried the original 2025 tables | Student Referrals INR 69.09 (19,000 / 275), matching an independent calculation from the source workbook. |
| "What's our NPS?" and "Which college sends the most attendees?" | No tool can answer | Refused and said what data is missing (survey data, college affiliation). |
| "Why did Creator Partners outperform Paid Social?" (false premise) | Compared both campaigns | Corrected the premise ("No: 64.3% of target vs 93.1%, INR 452 vs INR 183 per expected attendee"). The first version recommended scaling Creators; fixed with a rule that recommendations must match the verdict. |
| Changed data: logged 200 registrations for Student Referrals | Re-queried live data | Projected attendees moved from 2,166 to 2,795, identical on the dashboard and in the chat. The test row was deleted afterwards. |
| "Why are Paid Social registrations dropping?" | Compared funnel stages for the last 7 days vs the previous 7 | Traffic was flat but registration starts to registrations fell from 29% to 20%, so the leak is at registration completion. It found the overdue audit task and proposed a task; after confirmation it appeared under Tasks as "Created by analyst" and persisted after a refresh. |
| "If I move INR 20,000 from Paid Social to Student Referrals, what happens?" | Checked remaining budget first | Only INR 10,626 was unspent, so it simulated that amount instead and labelled the result an assumption, not a forecast. |

Calculations:

- Show-up booster: 2,800 registrations × (72% − 68.75%) = 91
- Referral squads: ₹15,000 / (₹69 × 2) = 109
- College passes: ₹25,000 / (₹81 × 2) = 154
- Community takeovers: ₹5,000 / (₹97 × 2) = 26
- Ambassador sprints: ₹15,000 / (₹108 × 2) = 69
- Net: 449 × 85% = 382, giving 2,050 + 382 = 2,432
- Budget cap: ₹44,000 moved from paid social and creators loses about 149 attendees (₹44,000 / ₹295 blended cost), giving 2,432 − 149 = 2,283

A 15% overlap discount is applied to the 449 gross incremental attendees
to account for people reached by more than one initiative. This gives an
estimated **382 net additional attendees**.

The overlap adjustment is a planning assumption. In execution, unique
referral codes, partner links and deduplicated attendee records should
be used to measure overlap more accurately.

### Prioritisation and trade-offs

The plan doubles down on referrals and college partnerships because they
had comparatively low historical spend per attendee and strong
registered-to-attended rates (78.6% and 85.6%, respectively).

It deprioritises additional paid social and creator spend because their
historical spend per attendee was higher (₹274 and ₹337, respectively),
with approximately 50% show-up.

The five growth bets also address different points in the funnel:

-   Show-up booster improves attendance conversion among people already
    registered.
-   Referral squads acquire new attendees through peer recommendations.
-   College club group passes build concentrated campus-level
    acquisition.
-   Community group takeovers reach relevant student communities.
-   Ambassador campus sprints create repeatable distribution across
    campuses.

Key risks are referral fraud, overlap between college and ambassador
leads, and message fatigue. The plan therefore uses attendance-based
referral rewards, unique tracking links and opt-out controls.

### Experiment thresholds and operating decisions

The presentation defines early signals and decision thresholds for each
initiative.

| Initiative | Early signal | Scale | Change | Stop |
|---|---|---|---|---|
| Show-up booster | Reconfirmation rate | 70%+ | 50–69% | Under 50% |
| Referral squads | Cost per expected attendee | ₹138 or less | ₹139–173 | Over ₹173 |
| College passes | Cost per expected attendee | ₹162 or less | ₹163–203 | Over ₹203 |
| Community takeovers | Cost per expected attendee | ₹194 or less | ₹195–243 | Over ₹243 |
| Ambassador sprints | Cost per expected attendee | ₹216 or less | ₹217–270 | Over ₹270 |

These initiative thresholds are applied by the team; the dashboard automates only the campaign rules below.

The broader campaign rules in the dashboard are:

-   **Stop:** below 60% of target and cost above 1.25× the average.
-   **Change:** below 90% of target or a bottleneck is detected.
-   **Scale:** at least 90% of target, no bottleneck, cost at or below
    average, and budget remaining.
-   **Keep:** all other cases.

When scaling, add budget in small steps. When changing a campaign,
address the weakest funnel stage and retest after four days. When
stopping, move unspent budget to the strongest-performing initiative.

These thresholds are management rules chosen for the assessment, not
statistically validated cut-offs. They should be revisited as real
campaign data accumulates.

### Product feedback loop

The Growth Center is intended to operationalise the strategy through a
continuous decision-and-execution loop:

1.  Log daily campaign data.
2.  Update the funnel and attendee projections.
3.  Diagnose campaign performance and recommend Scale, Keep, Change or
    Stop.
4.  Use the AI analyst to explain the recommendation using campaign
    data.
5.  Ask the user to confirm a proposed task.
6.  Assign the task to an owner for execution.
7.  Feed the next round of daily data back into the dashboard.

This connects campaign measurement to execution rather than treating the
dashboard as a passive reporting tool.

### Data sources and assumptions

1. **Provided assessment data** - The CampusFest 2025 dataset supplied with
the assessment is the historical benchmark for funnel volumes,
channel-attributed attendees, spend per attendee and show-up
comparisons. - The dataset is synthetic, as stated in the supplied
source workbook. It should not be represented as actual observed results
from a real festival.

2. **Planning assumptions** - The 2026 base and stretch funnel values are
scenario targets. - The ₹70,000 growth budget, initiative-level budgets
and estimated incremental attendees are proposed planning inputs. - The
assumption that added spend is 2× less efficient than the 2025 benchmark
is a modelling choice. - The 15% audience-overlap discount is an
assumption pending deduplicated campaign-level measurement. - The
₹3,00,000 budget-cap scenario and approximately 2,283 attendee outcome
are estimates based on the proposed reallocation. - Venue capacity must
be validated against the selected venue's permitted capacity and the
distribution of attendance across event days.

3. **Research limitation** Apart from the college count, the Bengaluru rationale is qualitative. It does not include a sourced campus-by-campus market-size
calculation or evidence of confirmed institutional partnerships. Those
should be validated before treating the audience opportunity as a
measured market.

### Research references

The festival links show that these institutions have hosted or promoted such events. They do not establish a partnership with CampusFest.

1. [Careers360: AISHE 2023-24 report summary](https://news.careers360.com/aishe-2023-24-higher-education-enrolment-reaches-4-50-crore-female-enrolment-rises-42-percentage-since-2014-15)
2. [Zee News: district-wise college counts from AISHE 2023-24](https://zeenews.india.com/education/50-districts-30-of-indias-colleges-the-hidden-geography-of-higher-education-3060810.html)
3. [CHRIST University: InBloom](https://inbloom.christuniversity.in/)
4. [St. Joseph's College of Commerce: Dhwani](https://www.sjcc.edu.in/Cultural_Facilities.php)
5. [Jyoti Nivas College: Scintillation](https://jyotinivas.org/style/events/2024/college/JNC%20Scintillation.pdf)
6. [Mount Carmel College: Cul-Ah 2026 brochure](https://mountcarmeluniversity.edu.in/wp-content/uploads/2026/02/cul-ah-brochure-26.pdf)
7. [PES University: MAAYA](https://www.clubs.pes.edu/maaya/about)
8. [News Karnataka: Samskruthi 2025 at BMS](https://newskarnataka.com/bengaluru/samskruthi-2025-wraps-up-with-thrills-talent-tasty-bites-at-bms-fest/07042025/)

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

The `orig_*` tables hold the supplied synthetic 2025 data. The 2026 campaign settings, campaigns, daily metrics and tasks are simulated for this assessment.

### Reset the demo data

Evaluators may edit data in the live app. To restore the original seeded state:

1. In the Supabase SQL Editor run:
   ```sql
   truncate daily_metrics, tasks, campaigns, settings cascade;
   ```
2. Re-import the CSVs from the `/data` folder into the existing tables (Table Editor > the table > Insert > Import data from CSV), in this order: `campaigns.csv`, `daily_metrics.csv`, `tasks.csv`, `settings.csv`.
3. Run these two statements to apply the final adjustments to the seeded data:
   ```sql
   update daily_metrics
   set spend = round(spend * 61.0 / 93.0)
   where campaign_id = (select id from campaigns where code = 'C02');

   update daily_metrics d
   set expected_attendees = d.registrations * c.assumed_showup
   from campaigns c where c.id = d.campaign_id;
   ```

The `orig_*` tables (the supplied 2025 data) are read-only in the app and do not need resetting.

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

Claude was used to help with the Vercel API routes, chart fixes, campaign decision rules, README and slide planning. Reused: the Google AI Studio template and the open-source libraries above.

Checks on the code changes: type-check and production build, and screen checks with made-up test data. There are no automated tests.

## Known limitations

- Cancellations do not reduce projected attendees.
- Capacity check does not model how attendees split across days.
- The app has no login, and `/api/chat` has no rate limit.
- The chat server accepts a Supabase URL and key sent by the browser.
- No automated tests.
- Row-level security is disabled for the demo, so anyone with the link can edit data. This lets reviewers test changed data; it must be enabled with proper policies before real use.
- The projection extrapolates the last 7 days linearly, so one unusually large day swings it sharply (for example, a single 200-registration day moved the total from 2,166 to 2,795).
- The analyst runs on a free-tier Gemini model and can occasionally return a 503 or 429 when the model is busy; the app retries and falls back to another model.
