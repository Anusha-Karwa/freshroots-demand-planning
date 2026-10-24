# Freshroots · Demand Planning

MESA AI-Native Track case study, *Deepa's 90-Day Mandate* (case in `docs/`), Option A: demand planning.

**Outcome:** Freshroots' ₹ losses from stockouts and overstock write-offs fall below the ₹28–34 L/quarter baseline
(≈ ₹9.3–11.3 L/month), with procurement acting on data no more than 4 days old instead of 3–4 weeks.

Twice a week the system takes the latest SAP sales and stock, applies Raghav's documented rules, flags SKUs
(high demand / stockout risk / overstock risk), has Gemini explain each flag in two lines and spot unusual cases,
and puts everything in front of Raghav. **Raghav makes the final call.** Approved lines become **draft** purchase
orders in Zoho Inventory, and procurement confirms them there.

```
Vercel Cron (Mon+Thu 06:00 IST) ─▶ SAP export + demand data ─▶ cleaning into Postgres ─▶ rules config
   ─▶ rules engine (no AI) ─▶ Gemini: 2-line reason + "looks unusual" routing ─▶ Raghav: approve / edit / reject
   ─▶ Zoho draft PO + Resend email ─▶ procurement confirms in Zoho
Every decision is logged ─▶ daily tracker (07:00 IST): actual vs forecast, stockouts, kill switch
```

## Run it locally (no keys needed)

```bash
npm install
npm run seed        # loads data/seed/*.csv into a local Postgres (PGlite, ./.data/pglite)
npm run forecast    # one forecast run, same as the Mon/Thu cron
npm run dev         # http://localhost:3000 — no login without DASHBOARD_PASSWORD
npm test            # 79 tests: every rule + edge cases, loader validation, Zoho client, kill switch, full pipeline
```

PGlite allows one process at a time: stop `npm run dev` before running `npm run seed` or `npm run forecast`
(or use the *Load the seed data* and *Run forecast now* buttons in the app).

Other scripts: `npm run tracker` (daily check), `npm run check:integrations`, `npm run zoho:refresh-token`,
`npm run zoho:verify`, `npm run zoho:sync-items`, `npm run db:generate` (after editing `src/db/schema.ts`).

## Pages

| Page | What it is for |
|---|---|
| **Overview** | Last run, data age, flags by type, items awaiting Raghav, kill-switch panel, ₹ losses vs baseline chart, payback, before → now |
| **Review queue** | Raghav's final call. SKU, category, perishable, flag, stock, weeks of cover vs window, 4-wk vs 12-wk %, expected demand, recommended qty, Gemini reason. Approve / Edit qty / Reject (reason required for edit and reject). Bulk approve only for stockout risk, after ticking "I have reviewed these lines". |
| **Exceptions** | What the rules can't decide (new SKU, > 40% week-on-week swing, one distributor driving > 40% of the change, rules that disagree, no stock figure, or Gemini says "looks unusual"). No rule quantity: Raghav sets it. |
| **Purchase orders** | Approved lines → one draft PO per supplier in Zoho (or MOCK). Zoho PO number and status, supplier → vendor mapping, API log, retry |
| **Tracker** | Daily actual vs forecast per SKU, stockout incidents, override log with reasons, data age at PO time, monthly ₹ loss entry (+ distributor complaints) |
| **Rules config** | Every threshold editable; each change is a new version with who / when / why. Perishable list. Baseline and kill-switch thresholds. |
| **Backtest** | Rules replayed on history vs what actually sold next; fresh vs month-old data in ₹; agreement with Raghav when his past flags are loaded |
| **Data** | Seed reload, SAP CSV upload with column mapping, competitor schemes / market events, load history |
| **Integrations** | Live / Mock per service with a Test button, email log |

## Adding the API keys later

Each service switches from MOCK to LIVE as soon as its variables are set. Nothing else changes. All names and
where to find them are in `.env.example`. Put them in `.env` locally and in **Vercel → Project → Settings →
Environment Variables**, then redeploy. Check them on the **Integrations** page or with `npm run check:integrations`.

| Service | Variables | Where |
|---|---|---|
| Postgres | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Vercel → Storage → Neon (fills both in). Migrations run automatically on first use. |
| Gemini | `GEMINI_API_KEY` (+ optional `GEMINI_MODEL`) | aistudio.google.com → Get API key |
| Zoho | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORGANIZATION_ID`, `ZOHO_DEFAULT_VENDOR_ID` | Step by step: [`docs/ZOHO_SETUP.md`](docs/ZOHO_SETUP.md) |
| Resend | `RESEND_API_KEY`, `EMAIL_FROM`, `PLANNER_EMAIL`, `PROCUREMENT_EMAIL`, `VIEWER_EMAIL` | resend.com → API Keys (test sender `onboarding@resend.dev` only delivers to your own address) |
| Security | `CRON_SECRET`, `DASHBOARD_PASSWORD`, `VIEWER_PASSWORD`, `AUTH_SECRET` | Make up long random strings |

## Deploy to Vercel

1. vercel.com → Add New → Project → import this GitHub repo (framework: Next.js, defaults are fine).
2. Storage → Create → **Neon** Postgres → connect it to the project (sets `DATABASE_URL` + `DATABASE_URL_UNPOOLED`).
3. Settings → Environment Variables → add the rest from `.env.example` (at least `CRON_SECRET` and
   `DASHBOARD_PASSWORD`). Redeploy.
4. Open the app → **Data → Load the seed data** → **Overview → Run forecast now**.
5. Cron jobs come from `vercel.json`: forecast `30 0 * * 1,4` (Mon + Thu 06:00 IST) and tracker `30 1 * * *`
   (daily 07:00 IST). Vercel sends `CRON_SECRET` automatically. On the Hobby plan each cron runs once a day at most,
   within the scheduled hour, which both jobs fit.

## Switching from seed data to a real SAP export

1. IT exports sales (billing by week × material × sold-to) and stock (MB52) as CSV — format and accepted headers in
   [`docs/SAP_EXPORT_FORMAT.md`](docs/SAP_EXPORT_FORMAT.md).
2. Load the SKU and distributor masters first if they changed (Data → Upload; SKU file needs perishability and
   standard order quantity; add `Unit_Cost` / `Unit_Price` to replace the placeholder prices).
3. Upload sales, then stock. Check the column mapping, read the rejected-rows summary and the warnings.
4. The next run (cron or *Run forecast now*) uses the new data. The seed data can stay: real uploads replace the
   weeks they contain, or reload a clean database before go-live.

## How this meets the case requirements

**Why demand planning first** (Option A over Distributor Service and Operations Intelligence): the loss is
measured and large (₹28–34 L/quarter), the logic is documented by the person who owns it (Raghav's rules cover
80–85% of decisions), the data exists and can be exported (3 years in SAP), the action system exists (Zoho), and
the bottleneck is manual data work that software removes. Distributor Service has no baseline data at all yet (no
query history, no categories, no response times). Operations Intelligence's bottleneck is who acts on a metric
and how fast, which is a process change before it's a build.

### The five pre-build decisions → where they are in the product

| Decision | In the product |
|---|---|
| 1. **Outcome**: lower ₹ losses from wrong procurement | Overview header and loss chart; Tracker's monthly ₹ losses is the primary metric |
| 2. **Baseline**: stockouts ₹18–22 L/qtr, overstock ₹10–12 L/qtr, data 3–4 weeks old, monthly cycle, Raghav ~2 days/month | Stored as editable settings (Rules page), shown on Overview (baseline band on the chart, "Before → now" table) |
| 3. **Workflow change**: twice-weekly pull → automated cleaning → rules → Gemini → Raghav → Zoho draft → procurement | Cron + Data page cleaning + rules engine + Gemini adapter + Review/Exceptions + Purchase orders. Nothing is ordered without Raghav's approval; Zoho POs are drafts only |
| 4. **Measurement**: ₹ losses vs baseline monthly; daily actual vs forecast; stockout frequency; override rate with reasons; data age at PO time; distributor complaints | Tracker page (all of them) + daily 07:00 cron |
| 5. **Kill criteria**: > 50% edited/rejected over 4 runs → halt; losses > ₹11 L/month 2 months running → stop, RCA, fix, redeploy; payback = ₹15 L ÷ monthly savings | Kill-switch panel (green / amber / red, with the reason), email to Deepa when it turns red, payback card |

### The case's facts → the build

| Case says | Build |
|---|---|
| Data is 3–4 weeks old; "if the data were organised I could run it twice a week" | SAP CSV upload with automatic cleaning; runs Mon + Thu; data age shown everywhere and recorded at decision and PO time |
| Raghav's 5 rules govern 80–85% of recommendations | Implemented exactly, as editable versioned config, with unit tests for each rule and the edge cases |
| The other 15–20% (new launches, unusual distributor behaviour, one-off events) are judgement | Exceptions queue; Gemini adds "looks unusual" cases with context from competitor schemes and the festival calendar; Raghav sets the quantity |
| Raghav's judgement is the asset | Raghav always has the final call; every edit and rejection keeps his reason, so the override log shows where the rules fall short |
| ₹15 L budget, 90 days, 3-person IT team, no AI team | Simple stack (Next.js + Postgres on Vercel, managed services), mock mode for every integration, one rules file, plain SQL migrations |
| Purchase orders live in Zoho Inventory | Draft POs via the Zoho API, one per supplier; procurement keeps confirming in Zoho |

### The 9 checks

The case asks for the course's 9 checks, but neither the case PDF nor the build brief lists them. Add them here
once they're available. The tables above give the evidence for each.

## Guardrails

- AI never sets quantities or places orders. Gemini's output schema has no quantity field, replies that mention an
  order quantity are dropped, and any Gemini failure falls back to the rule-based reason.
- Every recommendation shows the numbers behind it (averages, % change, stock, weeks of cover vs window, uplift).
- No real customer data: the seed data is synthetic; prices are placeholders and every ₹ figure built on them says so.
- No secrets in the repo (`.env` is git-ignored).

## Code map

```
src/lib/rules/       engine.ts (pure rules), config.ts (thresholds), reason.ts (template reasons)
src/lib/data/        columns.ts (header matching), parse.ts (₹/dates/weeks), clean.ts (validation), load.ts (DB writes)
src/lib/forecast/    inputs.ts (DB → engine input), run.ts (the twice-weekly run)
src/lib/adapters/    gemini.ts, zoho.ts, email.ts — each with live + mock mode
src/lib/             decisions.ts, purchase-orders.ts, tracker.ts, killswitch.ts, backtest.ts, notify.ts, settings.ts
src/app/(app)/       the pages;  src/app/actions.ts  every form action;  src/app/api/cron/  the two cron jobs
src/db/schema.ts     all tables;  drizzle/  generated SQL migrations
```

Assumptions made along the way are listed in [`ASSUMPTIONS.md`](ASSUMPTIONS.md).
