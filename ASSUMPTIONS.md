# Assumptions

Decisions made without asking. Each one is easy to change.

## Data
- **Seed data** (`data/seed/`): 15 SKUs, 4 distributors, 16 weeks of sales (ISO 2026-W27 → W42), one stock snapshot
  dated 19 Oct 2026, a 2025–2026 monthly calendar. Synthetic, so it is committed.
- **Sales have no distributor column.** They are stored per SKU (distributor `ALL`), so the single-distributor
  exception (rule 6b) is off. It switches on by itself once a sales file with distributors is loaded.
- **The SKU file's `Distributor_ID` is the supplier** the SKU is bought from (confirmed earlier). POs are grouped by it.
- **Prices are placeholders** (`data/placeholder_prices.csv`): the SKU file has no cost/price. Those SKUs are marked
  `price_source = placeholder` and the ₹ figures built on them say "estimated". Real prices never get overwritten
  by placeholders.
- **A week is its Monday.** A week belongs to the month its Thursday falls in.
- **Duplicate sales rows** (same week × SKU × distributor) are added up, since SAP exports are often per billing line.
- **Missing weeks** are reported as warnings and read as zero sales; they don't block a load.
- **Seed load** replaces sales and stock and upserts masters (SKUs not in the file become inactive). **SAP uploads**
  add to / update the data: a sales file replaces the week × SKU combinations it contains.
- **Local database without `DATABASE_URL`** is PGlite (real Postgres in WASM): same SQL as Neon, no Docker.

## Rules
- **Festival uplift** multiplies expected weekly demand (12-week average × 1.25) when the **planning date** (the run
  date, IST) is in a festival month. Stock cover is measured against the uplifted demand, so the uplift comes before
  the 6/14 and 3/4-week checks. The high-demand test compares two historical averages and is not uplifted.
- **Festival months** come from the rules config (editable); the calendar file is context for Gemini.
- **Strict edges**, as worded: "more than 20%", "falls below 6 weeks", "exceeds 14 weeks", "swings > 40%". Exactly
  on a threshold does not flag. Comparisons ignore floating-point noise.
- **Quantities**: high demand → 1.5 × standard; stockout risk → 1 × standard, "reorder now"; both → 1.5×, now;
  overstock → pause (0). The review page also shows how many units would reach the minimum cover.
- **Exceptions are not auto-recommended**: no recommended quantity; the rules' view (flags and quantity) is shown
  for reference, and Raghav sets the quantity.
- Extra exception cases: **high demand + overstock together** (the rules disagree) and **no stock figure**.
- **Distributor concentration** ignores tiny changes: only checked when the week-on-week change is at least 10% of
  the previous week (editable; set 0 to apply the rule literally). Otherwise, with few distributors, noise would
  trigger it all the time.
- **Zero sales**: no high-demand flag; any stock with no demand is overstock; zero stock + zero sales flags nothing.
  A jump from 0 to any sales is a week-on-week swing.
- Every rules change needs a note and is a new version; runs record which version they used.

## AI (Gemini)
- Gemini gets the engine's numbers and returns, per flagged SKU, a ≤ 2-sentence reason and an "unusual?" flag
  with a note. Batches of 12, 3 in parallel. Its JSON schema has no quantity field; a reason that mentions an
  order quantity is dropped.
- **Routing**: rule exceptions are routed by the rules. Gemini may additionally move a rule-covered flag to the
  exceptions queue ("Looks unusual (AI)"). The quantity is then removed and Raghav decides. In mock mode nothing
  is AI-routed.
- Default model `gemini-flash-latest` (override with `GEMINI_MODEL`). Thinking is kept low so it doesn't eat the
  output budget; any failure falls back to the template reason and is noted on the run.

## Decisions & orders
- Decisions are made on the **latest run only**; a line can be changed until it is on a PO.
- Editing to the recommended quantity counts as an approval. Exceptions approved with Raghav's quantity count as
  approvals, and they are not part of the override rate (there is no rule recommendation to override).
- **Only the latest run's approved lines with qty > 0** are ordered; lines are claimed before the Zoho call, so a
  double click can't order twice. A failed PO keeps its lines and can be retried.
- **One draft PO per supplier**; unmapped suppliers use `ZOHO_DEFAULT_VENDOR_ID` (live) or a mock vendor (mock).
  PO rates are unit costs.
- In mock mode, "Simulate procurement confirm" stands in for procurement issuing the draft in Zoho.

## Measurement
- **Daily early warning**: SAP sales arrive weekly, so the daily job compares the latest loaded week's actual units
  with the forecast for that week. The forecast is taken from the last run made before that week's data, or, if
  none exists, from the rules re-run on the weeks before it. Beyond ±25% is flagged (editable).
- **Stockout incidents**: logged automatically when a SKU with demand shows 0 stock, valued at one week of forecast
  × unit price; manual incidents can be added.
- **Monthly ₹ losses** (primary metric) are entered from finance's numbers on the Tracker.
- **Kill switch**: early = (edited + rejected) ÷ decided review recommendations over the last 4 runs with decisions;
  red > 50%, amber > 35%. Outcome = red when the latest 2 consecutive months are each > ₹11 L; amber when the latest
  month is. Overall = the worse; grey = not enough data. Deepa is emailed when it *turns* red.
- **Payback** = ₹15 L ÷ (baseline midpoint ₹10.33 L/month − average loss of the last up to 3 months).
- **Data age** = days from the last day of sales data to today / the decision / the PO.

## Backtest
- With no history of Raghav's calls, the backtest replays the high-demand rule week by week and checks whether
  demand stayed > 20% up over the next 4 weeks. It also compares the twice-weekly forecast (fresh data) with the
  monthly cycle (data 4 weeks older), costing under-forecast at price and over-forecast at cost.
- With one stock snapshot, stock flags can't be replayed for past weeks; uploading weekly stock snapshots enables it.
- Uploading Raghav's past flags (Data page) adds the agreement score (target ≥ 85%).
- 16 weeks of data with a 12-week window leaves 4 replay weeks, not 6–12 months.
- On the seed data, fresh vs month-old data makes almost no difference (demand is flat except SKU001's step up),
  and the result is reported as is.

## Product
- Two roles via shared passwords: `DASHBOARD_PASSWORD` (planner) and `VIEWER_PASSWORD` (viewer). Each person types
  their name at sign-in, and that name goes in the decision log and the rules history. Without
  `DASHBOARD_PASSWORD` (local dev) there is no login.
- Extra env vars beyond the brief: `VIEWER_PASSWORD`, `VIEWER_EMAIL` (Deepa's alert), `AUTH_SECRET`,
  `APP_BASE_URL`, `DATABASE_URL_UNPOOLED`.
- Uploaded CSVs wait in the database between upload and column mapping (serverless instances share nothing else)
  and are deleted after 7 days. Excel files must be saved as CSV first.
- The distributor file includes Karnataka and Gujarat although the case says Maharashtra + Goa; loaded as supplied.
- The case's "9 checks" are not listed in the case or the brief, so the README maps the build to the 5 pre-build
  decisions and the case facts, and leaves a place for the 9 checks.
