# Freshroots Demand Planning

MVP for the MESA AI-Native Track case *Deepa's 90-Day Mandate* (Option A — Demand Planning).

Twice a week the system pulls sales and stock data, applies Raghav's documented forecasting rules, flags SKUs
for reorder / stockout risk / overstock risk, and explains each flag. Raghav makes the final call on the
dashboard; approved lines become **draft** purchase orders in Zoho Inventory, which procurement confirms.

**Outcome it is measured against:** rupee losses from stockouts + overstock write-offs below the baseline of
₹28–34 L per quarter, with procurement acting on data ≤ 4 days old (today: 3–4 weeks).

> Rules compute. Raghav decides. Procurement confirms. The AI only writes explanations — it never sets
> quantities or places orders.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Scaffold, `.env.example`, DB schema, seed loader, mock adapters, Integrations page; real seed data loaded | ✅ done |
| 2 | Rules engine + unit tests + backtest page; `npm run forecast` | ✅ done |
| 3 | Dashboard: login (planner / viewer), overview, review queue, exceptions, rules config, SAP CSV upload | ✅ done |
| 4 | Gemini explanations + AI routing, decision log, tracker, kill-switch panel, payback | ✅ done |
| 5 | Draft PO flow (Zoho live client + mock), Resend emails, cron endpoints | ✅ done |
| 6 | Full README, deploy guide, case-requirements mapping | next |

## Quick start (no API keys needed)

```bash
npm install
npm run seed            # loads data/seed/*.csv
npm run forecast        # run the rules on the loaded data and save the run (the cron job does this Mon + Thu)
npm run dev             # http://localhost:3000
npm test
```

Without `DATABASE_URL` the app uses an embedded Postgres (PGlite) in `./.data/pglite`. Only one process can
open it at a time, so stop `npm run dev` before running `npm run seed`.

## Seed data

Place the five CSVs in `data/seed/` (see `data/seed/README.md`), then:

```bash
npm run seed -- --inspect   # show the columns found in each file and how they map — loads nothing
npm run seed                # load + validate; prints accepted/rejected rows and the checks
```

Current data: 15 SKUs, 4 distributors, weekly sales for ISO weeks 2026-W27 → W42 (per SKU, no distributor
split), stock as of 19 Oct 2026, a monthly festival calendar for 2025–26. Prices are placeholders from
`data/placeholder_prices.csv` until real ones arrive; ₹ figures built on them are marked *estimated*.

Validation: every sales row's SKU and distributor must exist; no negative stock; no missing weeks.
Rejected rows are listed with row number and reason, and stored in the `rejected_rows` table.
Header names are matched flexibly; to support a new header, add it to `aliases` in
`src/lib/seed/columns.ts`. The SAP export format is in [`docs/SAP_EXPORT_FORMAT.md`](docs/SAP_EXPORT_FORMAT.md).

## Pages

| Page | Who | What |
|---|---|---|
| Overview | all | last run, data age, items awaiting Raghav, flags by type, baseline, recent runs; planner can run the forecast now |
| Review queue | planner decides, viewer reads | every flagged SKU with the numbers behind it; approve / edit qty / reject (reason required); bulk approve for stockout lines after ticking "I have reviewed these" |
| Exceptions | planner decides | cases the rules can't decide; order a quantity or no action, always with a note |
| Purchase orders | planner creates | approved lines grouped into one draft PO per supplier → Zoho (or MOCK); status, retries, supplier → Zoho vendor mapping, Zoho API log |
| Tracker | planner enters, all read | kill switch (green / amber / red), monthly ₹ losses vs baseline chart + entry, actual vs forecast per SKU (early warning), stockout incidents, Raghav's overrides with reasons and data age at decision, distributor complaints |
| Rules | planner edits | thresholds, festival months and uplift, perishable list; each save is a new version with who/when/why and a diff |
| Data | planner uploads | SAP CSV upload → column mapping → load report with rejected rows; recent loads |
| Backtest | all | rules replayed against what actually sold |
| Integrations | all | each service Live / Mock |

Login: set `DASHBOARD_PASSWORD` (planner) and `VIEWER_PASSWORD` (viewer). Users type their name at sign-in; it is
recorded on every decision and rules change. Without `DASHBOARD_PASSWORD` (local dev) there is no login.

## Integrations

Every external service has a mock mode that switches on automatically when its keys are missing; see the
**Integrations** page. Variables are listed with where to get them in [`.env.example`](.env.example).

| Service | Mock behaviour |
|---|---|
| Postgres | PGlite in `./.data/pglite` |
| Gemini | Template-based reasons from the rule numbers |
| Zoho Inventory | Draft POs in `mock_zoho_purchase_orders`, labelled MOCK |
| Resend | Emails logged to console + `mock_emails` |

## Scheduled jobs

| Route | When (vercel.json, UTC) | What |
|---|---|---|
| `/api/cron/forecast` | `30 0 * * 1,4` = Mon + Thu 06:00 IST | rules on the latest loaded data → Gemini reasons → email Raghav "N items awaiting your call" |
| `/api/cron/tracker` | `30 1 * * *` = daily 07:00 IST | actual vs forecast, stockouts, kill switch (emails Deepa when it turns red), Zoho PO status sync |

Both need `Authorization: Bearer $CRON_SECRET` (Vercel sends it once `CRON_SECRET` is set). Locally:
`curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/forecast`.

## Zoho scripts (live mode)

```bash
npm run zoho:refresh-token -- <grant-code>   # one-time: grant code → refresh token (see docs/ZOHO_SETUP.md)
npm run zoho:sync-items -- --limit 20        # create Zoho items for SKUs that don't have one yet
```

## Project layout

```
src/lib/db/schema.ts       all tables (Drizzle); migrations in drizzle/
src/lib/config/            rules + baseline defaults (editable at runtime, versioned in the DB)
src/lib/seed/              column mapping, parsing, loader + validation
src/lib/rules/engine.ts    Raghav's rules — pure functions, no AI (tests/rules.test.ts)
src/lib/rules/run.ts       data → rules → decision log (forecast_runs, recommendations, exceptions)
src/lib/rules/backtest.ts  replay past weeks vs what actually sold
src/lib/purchase-orders.ts approved lines → one draft PO per supplier
src/lib/tracker.ts         actual vs forecast, stockouts, override log
src/lib/killswitch.ts      green / amber / red + payback (tests/killswitch.test.ts)
src/lib/notify.ts          the three emails
src/app/api/cron/          the two scheduled jobs
src/lib/adapters/          gemini, zoho, email — live or mock
src/lib/integrations.ts    live/mock detection
scripts/                   seed, db-migrate
tests/                     vitest
```

Schema changes: edit `src/lib/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`.
Migrations apply automatically on first database use.

See [`ASSUMPTIONS.md`](ASSUMPTIONS.md) for decisions made along the way.
