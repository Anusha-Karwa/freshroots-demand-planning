# Freshroots Demand Planning

MVP for the MESA AI-Native Track case *Deepa's 90-Day Mandate* (Option A — Demand Planning). The case and
the components map are in [`docs/`](docs).

Twice a week the system takes the latest sales and stock data, applies Raghav's documented forecasting rules,
flags SKUs for reorder / stockout risk / overstock risk, and explains each flag. Raghav makes the final call on
the dashboard; approved lines become **draft** purchase orders in Zoho Inventory, which procurement confirms.

**The outcome it is measured against:** rupee losses from stockouts + overstock write-offs below the baseline of
₹28–34 L per quarter (≈ ₹9.3–11.3 L a month), with procurement acting on data ≤ 4 days old instead of 3–4 weeks.

> Rules compute. Raghav decides. Procurement confirms. The AI only writes explanations and can send a case to
> Raghav's exceptions queue — it never sets quantities and never places orders.

Contents: [How it works](#how-it-works) · [Run it locally](#run-it-locally-no-keys-needed) · [Pages](#pages) ·
[Adding API keys](#adding-each-api-key-later) · [Deploy to Vercel](#deploy-to-vercel) ·
[Real SAP data](#switching-from-the-seed-data-to-a-real-sap-export) · [Case requirements](#how-this-meets-the-case-requirements) ·
[For the IT team](#for-the-it-team)

## How it works

| Step (components map lane) | What happens | Where |
|---|---|---|
| **Scheduler** — Vercel Cron | Mon + Thu 06:00 IST forecast run; daily 07:00 IST tracker | `vercel.json`, `src/app/api/cron/` |
| **Data sources** — SAP + demand data | Sales by SKU × week (× distributor when available), stock, SKU and distributor masters, festival calendar. Loaded from the seed files or a SAP CSV upload | `data/seed/`, Data page |
| **System: ingest + clean** | Header mapping, type parsing, rejected rows with reasons, missing-week and coverage checks | `src/lib/seed/` |
| **System: rules config** | Raghav's thresholds, festival months + uplift, perishable list — versioned | Rules page |
| **System: rules engine (no AI)** | Festival uplift → high demand / stockout / overstock flags and quantities; exceptions for the cases rules can't decide | `src/lib/rules/engine.ts` |
| **AI model** — Gemini | Writes a 2-line reason per flag; may move an odd-looking flag to the exceptions queue; never sets a quantity | `src/lib/adapters/gemini.ts` |
| **Raghav** | Final call: approve / edit qty / reject (reason required) | Review queue, Exceptions |
| **Services** — Zoho + Resend | Approved lines → one draft PO per supplier; emails to Raghav, procurement and Deepa | Purchase orders page, `src/lib/notify.ts` |
| **Procurement** | Confirms the draft PO inside Zoho; the daily job syncs the status back | Zoho |
| **System: decision log + tracker** | Every decision with who / when / why; actual vs forecast; ₹ losses; kill switch | Tracker page |

## Run it locally (no keys needed)

Needs Node 22+.

```bash
npm install
npm run seed            # load data/seed/*.csv into the local database
npm run forecast        # run the rules once (the cron job does this Mon + Thu)
npm run dev             # http://localhost:3000
npm test                # 108 tests
```

Without `DATABASE_URL` the app uses an embedded Postgres (PGlite) in `./.data/pglite` — the same SQL as Neon,
no Docker. Only one process can open it at a time, so stop `npm run dev` before `npm run seed`. Without
`DASHBOARD_PASSWORD` there is no login and you are the planner. Every external service runs in mock mode.

## Pages

| Page | Who | What |
|---|---|---|
| Overview | all | last run, data age, items awaiting Raghav, flags by type, kill switch, ₹ losses vs baseline chart, baseline, recent runs; planner can run the forecast now |
| Review queue | planner decides, viewer reads | every flagged SKU with the numbers behind it and the reason; approve / edit qty / reject (reason required); bulk approve for stockout lines after ticking "I have reviewed these" |
| Exceptions | planner decides | cases the rules can't decide (new SKU, one distributor drives the change, week-on-week swing > 40%, rules conflict, Gemini "looks unusual"); order a quantity or no action, always with a note |
| Purchase orders | planner creates | approved lines grouped into one draft PO per supplier → Zoho (or MOCK); status, retries, supplier → Zoho vendor mapping, Zoho API log |
| Tracker | planner enters, all read | kill switch, payback, monthly ₹ losses (entry + chart), actual vs forecast per SKU, stockout incidents, Raghav's overrides with reasons and data age, distributor complaints |
| Rules | planner edits | thresholds, festival months and uplift, perishable list; each save is a new version with who / when / why and a diff |
| Data | planner uploads | SAP CSV upload → column mapping → load report with rejected rows; recent loads |
| Backtest | all | the rules replayed on past weeks against what actually sold; fresh vs monthly forecast error; simulated ₹ impact |
| Integrations | all | each service Live / Mock, scheduled jobs, emails logged in mock mode |

**Login:** `DASHBOARD_PASSWORD` unlocks the **planner** role (Raghav), `VIEWER_PASSWORD` the read-only
**viewer** role (Deepa / CEO). People type their name at sign-in; it is recorded on every decision and rules
change. Every write is checked for the planner role on the server.

## Adding each API key later

All variables are listed with comments in [`.env.example`](.env.example). Put them in `.env` for local runs
and in **Vercel → Project → Settings → Environment Variables** for the deployed app (then redeploy). The
**Integrations** page shows each service switching from Mock to Live.

| Service | Variables | Where to get them | Mock until then |
|---|---|---|---|
| Database (Neon) | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Vercel → Storage → add **Neon** (fills both in), or Neon console → project → Databases → *New database* `freshroots` → connection strings (pooled + direct) | Local PGlite (not allowed on Vercel) |
| Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | aistudio.google.com → *Get API key*; model e.g. `gemini-3.8-flash` | Template reasons, no AI routing |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM`, `PLANNER_EMAIL`, `PROCUREMENT_EMAIL`, `VIEWER_EMAIL` | resend.com → API Keys; `EMAIL_FROM` = a verified domain, or `onboarding@resend.dev` for testing | Emails logged to console + Integrations page |
| Zoho Inventory | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID`, `ZOHO_DEFAULT_VENDOR_ID` (+ `ZOHO_ACCOUNTS_URL`, `ZOHO_API_BASE` for the India DC) | Step by step in [`docs/ZOHO_SETUP.md`](docs/ZOHO_SETUP.md); the refresh token comes from `npm run zoho:refresh-token -- <grant-code>` | Draft POs stored locally and labelled MOCK |
| App | `DASHBOARD_PASSWORD`, `VIEWER_PASSWORD`, `CRON_SECRET`, `AUTH_SECRET`, `APP_BASE_URL` | Make up long random strings; `APP_BASE_URL` = the Vercel URL (used in email links) | No login; cron open locally only |

## Deploy to Vercel

1. **Import the repo.** vercel.com → *Add New → Project* → import `freshroots-demand-planning`. Framework:
   Next.js (detected). Keep the default build settings.
2. **Add the database.** Project → *Storage* → *Create* → **Neon** → connect to this project. This sets
   `DATABASE_URL` and `DATABASE_URL_UNPOOLED`. (Using an existing Neon project instead? Create a separate
   database `freshroots` and paste both connection strings in as variables.)
3. **Add the other variables** (table above). At minimum: `DASHBOARD_PASSWORD`, `VIEWER_PASSWORD`,
   `CRON_SECRET`, `AUTH_SECRET`, `APP_BASE_URL`. Add Gemini / Resend / Zoho when you have them.
4. **Deploy.** Tables are created automatically on first use (migrations in `drizzle/`, applied under a lock).
5. **Load the data into Neon** from your computer: put the same `DATABASE_URL` in your local `.env`, then
   `npm run seed` and `npm run forecast`. (Or upload the CSVs on the Data page after logging in.)
6. **Check the cron jobs.** Project → *Settings → Cron Jobs* lists `/api/cron/forecast` (Mon + Thu 00:30 UTC
   = 06:00 IST) and `/api/cron/tracker` (daily 01:30 UTC = 07:00 IST). Vercel sends `CRON_SECRET`
   automatically. On the Hobby plan crons run once a day at most (these do) and may fire any time within
   the scheduled hour. Use *Run* there to test one.
7. **Open the app**, sign in with the planner password, and check the Integrations page.

## Switching from the seed data to a real SAP export

The seed data in `data/seed/` is synthetic (15 SKUs, 16 weeks, SKU-level sales). To use the IT team's export:

1. Export as CSV in the format in [`docs/SAP_EXPORT_FORMAT.md`](docs/SAP_EXPORT_FORMAT.md) — weekly sales by
   SKU × distributor, stock on hand, and (when they change) the SKU, distributor and calendar masters.
   The SKU file must have **perishability** and **standard order quantity**.
2. **One-off full replacement:** put the files in `data/seed/` (same names) and run
   `npm run seed -- --inspect` (shows how the columns map, loads nothing), then `npm run seed`.
   Header names are matched flexibly; add new ones to `aliases` in `src/lib/seed/columns.ts`.
3. **Twice-weekly updates:** on the **Data** page upload the new week's sales and the current stock. The page
   shows the column mapping before loading and a report of every rejected row. Uploads add to / update what
   is loaded.
4. Replace `data/placeholder_prices.csv` by adding `Unit_Cost` / `Unit_Price` columns to the SKU file, so ₹
   figures stop being marked *estimated*.
5. With distributor-level sales, the "one distributor drives > 40% of the change" exception switches on by
   itself. Delete the seed files from the repo once real data is in use.

## How this meets the case requirements

### The five pre-build decisions, built into the product

| Decision | In the product |
|---|---|
| **1. Outcome:** lower ₹ losses from wrong procurement (stockouts + overstock) | The primary metric everywhere: Overview and Tracker chart monthly ₹ losses against the baseline; the outcome kill switch and payback are computed from it. Raghav's time saved and forecast accuracy are shown as means, not the goal. |
| **2. Baseline:** stockouts ₹18–22 L/qtr, overstock ₹10–12 L/qtr, data 3–4 weeks old, monthly cycle, ~2 days/month of Raghav's time | Stored as editable settings (`app_settings.baseline`, defaults in `src/lib/config/baseline.ts`) and shown on the Overview; the chart draws the ₹9.3–11.3 L/month band. |
| **3. Workflow change:** monthly SAP download → Excel → Raghav's logic → Zoho, becomes Mon + Thu pull → automated cleaning → rules engine → Gemini reasons + exception routing → Raghav's final call → draft POs → procurement confirms | Cron jobs, loader, rules engine, Gemini adapter, review / exceptions queues, PO page. Nothing is ordered without Raghav's approval; Zoho POs are drafts only. Data age is shown on every page (target ≤ 4 days). |
| **4. Measurement plan:** primary ₹ losses vs baseline monthly; daily early warning of depletion vs forecast; secondary stockout frequency, override rate with reasons, data age at PO time, distributor complaints | Tracker page: monthly loss entry + chart; daily actual vs forecast per SKU (> 25% off flagged); stockout incidents (auto-detected + manual) and most-frequent SKUs; override log with reasons and data age at decision; POs record the data date; complaints entry. |
| **5. Kill criteria:** override rate > 50% over the last 4 runs → halt and re-evaluate; losses above ₹11 L/month for 2 consecutive months → stop, RCA, fix, redeploy; payback = ₹15 L ÷ monthly savings vs the baseline midpoint | Green / amber / red panel on Overview and Tracker (`src/lib/killswitch.ts`, tested); Deepa is emailed when it turns red; payback in months shown under it. |

### Raghav's rules

All six documented rules are implemented as editable, versioned config with a unit test for each rule and its
edges (exactly 20%, exactly 6 / 14 weeks, festival month + perishable, zero sales): festival uplift first,
high demand → 1.5× standard qty, stockout risk < 6 weeks → reorder now, overstock risk > 14 weeks → pause,
perishable window 3–4 weeks, and the exceptions Raghav handles on judgement (new SKU < 12 weeks of history,
one distributor > 40% of the week-on-week change, week-on-week swing > 40%). The backtest replays them against
what actually sold; agreement with Raghav's own past calls (target ≥ 85%) is computed once his history is loaded.

### Guardrails

AI never decides quantities or places orders (no quantity in Gemini's output schema; tested). Every
recommendation shows the numbers behind it. Every decision and rules change records who, when and why. No
secrets in the repo; the seed data is synthetic.

### The 9 checks

> **To complete:** the case asks to judge the options with the course's *9 checks*, which are not listed in the
> case PDF. Add the list here (one row per check, with the feature or evidence that satisfies it) once it is
> provided — the decisions table above already covers the *Pre-Build Decision Checklist*.

## For the IT team

```
src/lib/db/schema.ts       all tables (Drizzle); migrations in drizzle/
src/lib/config/            rules + baseline defaults (editable at runtime, versioned in the DB)
src/lib/seed/              column mapping, parsing, loader + validation
src/lib/rules/engine.ts    Raghav's rules — pure functions, no AI (tests/rules.test.ts)
src/lib/rules/run.ts       data → rules → Gemini → decision log
src/lib/rules/backtest.ts  replay past weeks vs what actually sold
src/lib/purchase-orders.ts approved lines → one draft PO per supplier
src/lib/tracker.ts         actual vs forecast, stockouts, override log
src/lib/killswitch.ts      green / amber / red + payback
src/lib/notify.ts          the three emails
src/lib/adapters/          gemini, zoho, email — live or mock
src/app/                   pages and server actions; src/app/api/cron/ the two scheduled jobs
scripts/                   seed, forecast, db-migrate, zoho:refresh-token, zoho:sync-items
tests/                     vitest (npm test)
```

| Task | How |
|---|---|
| Change a threshold | Rules page (no deploy needed) |
| Add a column alias for a new SAP header | `aliases` in `src/lib/seed/columns.ts` |
| Change the schema | edit `src/lib/db/schema.ts` → `npm run db:generate` → commit the new file in `drizzle/` |
| Run the jobs by hand | `curl -H "Authorization: Bearer $CRON_SECRET" <url>/api/cron/forecast` (or `/tracker`) |
| Zoho, live mode | `npm run zoho:refresh-token -- <grant-code>`, `npm run zoho:sync-items -- --limit 20` |

Decisions made along the way are in [`ASSUMPTIONS.md`](ASSUMPTIONS.md).

**Not yet verified against the real services:** Gemini, Resend and Zoho run in mock mode in development and
their live clients are tested against fakes only; Neon has not been connected yet. Check the Integrations page
after adding each key.
