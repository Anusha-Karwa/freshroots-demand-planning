# Assumptions

Decisions made without asking. Each one is easy to change; say so if any is wrong.

## Source documents
- The case (`docs/MESA_Case_01_-_22_Oct.pdf`) and the components map (`docs/Freshroots_Components_Map_v2.png`)
  are in `docs/`. The build follows the map's lanes: Vercel Cron → SAP + demand data → cleaning into Postgres →
  rules config → rules engine (no AI) → Gemini reasons + exceptions → Raghav's final call → Zoho draft PO +
  Resend email → procurement confirms in Zoho; every decision is logged and feeds the daily tracker / kill switch.
- The case mentions "the 9 checks" and "the Pre-Build Decision Checklist" but does not list them; the README's
  requirements mapping (phase 6) will use the course's list once provided.
- The case's "unusual distributor behaviour, new launches, one-off market events" (the 15–20% Raghav handles on
  judgement) map to the three exception rules: new SKU (< 12 weeks), single-distributor concentration, and
  week-on-week swings > 40%.
- The map puts the **perishable list** in the rules config, so the Rules page (phase 3) will let Raghav change a
  SKU's perishability as a versioned rules change, on top of the flag from the SKU file.
- The map has Gemini "route odd cases to exceptions". Routing stays rule-based so it is predictable; Gemini can
  additionally mark a rule-covered flag as "looks unusual", which moves it to the exceptions queue for Raghav.
  It never changes a quantity.
- The case says SAP holds three years of distributor-level sales; the seed data supplied is 16 weeks at SKU
  level. The loader handles both.

- **Seed data** is in `data/seed/` (15 SKUs, 4 distributors, 16 weeks: ISO weeks 2026-W27 → W42, stock as of
  19 Oct 2026). It is synthetic and small, so it is committed. The earlier placeholder sample was deleted.

## Data & database
- **Local database without `DATABASE_URL` is PGlite** (real Postgres compiled to WASM, stored in `./.data/pglite`)
  rather than SQLite. Same SQL dialect as Neon/Supabase in production, one schema, one set of migrations,
  no Docker. Limitation: only one process can open it at a time — stop `npm run dev` before `npm run seed`.
- **ORM is Drizzle** (the prompt allowed Prisma or Drizzle). Drizzle supports both PGlite and node-postgres
  from one schema; Prisma would need separate SQLite/Postgres schemas.
- **Seed files are CSV** with a header row. Excel files should be saved as CSV first.
- **A week is identified by its Monday.** ISO week labels (`2026-W27`) are converted to that Monday.
  "No missing weeks" means every 7-day step between the first and last sales week has rows, overall and
  within each SKU's own history.
- **The calendar is monthly** (as supplied). A sales week belongs to the month its Thursday falls in (ISO
  convention, so a week is never split across months). Sales weeks outside the calendar are rejected.
- **Festival months**: the rules config (editable, versioned) is what the engine uses; the seed loader checks
  that the calendar's festival months agree with it (both are Mar, Oct, Nov today).
- **Sales/stock quantities are decimals** (numeric), since SAP exports can carry kg/litre units.
- **Negative sales units are accepted** (returns/credit notes); only negative *stock* is rejected, as the prompt asks.
- **Duplicate rows** (same week × SKU × distributor) — the last one in the file wins; duplicates are counted
  in the summary.
- **Inventory without a date column** is treated as a snapshot taken the day after the last sales week.
- **`npm run seed` is a full reload**: it clears master data, sales and stock first (run history,
  decisions and POs are kept). The SAP CSV upload (phase 3) upserts on top instead.
- **SKU rows with standard order qty ≤ 0 are rejected**, since the 1.5× rule needs a positive quantity.
- **Sales have no distributor column** (confirmed with Anusha). Sales are stored per SKU (distributor `ALL`),
  and rule 6b — "a single distributor drives > 40% of the week-on-week change" — is **off** until a sales file
  with a distributor column is loaded; it then switches on automatically.
- **`Distributor_ID` on the SKU file is the SKU's supplier** (confirmed). Approved lines are grouped into one
  draft PO per supplier; each supplier is mapped to a Zoho vendor in phase 5.
- **Prices are placeholders** (confirmed). The SKU file has no cost/price, so `data/placeholder_prices.csv`
  supplies a made-up cost and price per SKU. Those SKUs are marked `price_source = placeholder` and every ₹
  figure built on them is labelled *estimated*. Adding `Unit_Cost` / `Unit_Price` columns to the SKU file
  replaces them.
- **Short history**: 16 weeks with a 12-week average leaves about 4 historical runs to backtest, not 6–12 months.
- The distributor file includes Karnataka and Gujarat; the case says Maharashtra + Goa. Loaded as supplied.

## Rules
- **Festival uplift** multiplies *expected* weekly demand (12-week average × 1.25) when the week being planned
  falls in a festival month (the month of that week's Thursday). Stock cover is measured against that uplifted
  demand, so the uplift is applied before the 6/14 and 3/4-week checks. The 20% high-demand test compares two
  historical averages; uplifting both sides would cancel out, so it is left as is.
- **Edges are strict**, as worded: "more than 20%", "falls below 6 weeks", "exceeds 14 weeks", "swings > 40%".
  Exactly 20% / 6 / 14 / 40% does not flag. Comparisons ignore floating-point noise (1000/12 × 1.2 is
  99.99999999999999 in JavaScript — a test caught this).
- **Quantities**: high demand → 1.5 × standard order qty; stockout risk alone → 1 × standard qty, flagged
  "reorder now"; both → 1.5×, now; overstock → pause (0). Raghav can edit any quantity.
- **High demand + overstock together** is treated as a conflict and sent to Raghav's exceptions queue
  (demand rising, stock already too high — the rules disagree).
- **Exceptions are checked first**; an exception SKU gets no recommended quantity. The exception note lists
  which rule flags it would otherwise have raised.
- **Zero sales**: no high-demand flag (no baseline); any stock with zero demand is overstock; zero stock and
  zero sales is no flag. A jump from 0 to any sales counts as a week-on-week swing.
- **Backtest** (no Raghav history, one stock snapshot): replays high-demand flags against what actually sold
  next, compares twice-weekly forecasts with the monthly cycle (data 4 weeks older) and values the gap in ₹.
  Stock flags are replayed automatically once weekly stock snapshots are loaded.
- Rules and the baseline/kill-switch numbers live in the database (`rules_config_versions`, `app_settings`),
  seeded from `src/lib/config/*.ts` defaults. Nothing is hard-coded in the engine.
- Kill-switch outcome threshold is stored as ₹11 L/month (as written in the prompt) rather than derived
  from ₹34 L ÷ 3 = ₹11.3 L.

## AI (Gemini)
- One Gemini call per flag returns JSON `{reason, unusual, unusualWhy}`, validated before use. There is no
  quantity field; anything malformed, slow or failing falls back to the template reason. Calls run 5 at a time.
- "Routes unusual cases to exceptions": rule-based exceptions are routed first; Gemini can additionally move a
  rule flag to the exceptions queue (type "Looks unusual (AI)") with its reason. Raghav still decides; the rule
  flags are shown with it. In mock mode nothing is AI-routed.

## Measurement
- **Daily early warning** compares the latest week's actual units with the forecast for that week — the one a
  run saved, or (for history no run planned) the rules re-run on the weeks before it. SAP sales arrive weekly,
  so the daily job's numbers change when a new week is loaded. More than 25% off forecast is flagged.
- **Stockout incidents** are detected when a SKU that sold last week has 0 stock; the estimate is one week of
  forecast demand at unit price. Planners can also add incidents by hand.
- **Monthly ₹ losses** (primary metric) are entered by hand from finance's numbers, as the brief allows.
- **Kill switch**: early = edited + rejected ÷ decided recommendations over the last 4 runs that had
  decisions (red > 50%, amber > 35%); outcome = total monthly loss > ₹11 L for the 2 latest months (red), latest
  month alone (amber). Overall = the worse of the two; grey = not enough data.
- **Payback** = ₹15 L ÷ (baseline midpoint ₹10.33 L/month − average loss of the last up to 3 months).
- **Data age at decision** = days from the last day of sales data in the run to Raghav's decision.

## Product
- Two extra env vars beyond the prompt's list: `VIEWER_PASSWORD` (read-only login for Deepa/CEO, the
  `viewer` role) and `VIEWER_EMAIL` (where the red kill-switch alert goes).
- With no `DASHBOARD_PASSWORD`, local dev skips login and treats everyone as the planner.
- Login is a shared password per role; each person types their name at sign-in, and that name is what the
  decision log and rules history record. Fine for an MVP with two roles; swap for real accounts later.
- "Bulk approve for stockout risk only after viewing" = the bulk form lists every stockout line with its
  numbers, each line can be unticked, and a required "I have reviewed these lines" box must be ticked.
- Decisions can be changed until the line is on a purchase order. Editing to the recommended quantity counts as
  an approval (the reason is still kept).
- SAP uploads add to / update existing data (seed loads replace it). If a SKU-week has both SKU-level and
  distributor-level rows, the distributor detail is kept. A load check warns when the newest week covers only
  some SKUs, since missing SKUs would read as zero sales.
- Zoho is skipped for now (account sign-up was blocked on Zoho's side): purchase orders stay in mock mode.
- Vercel Cron schedules are in UTC: forecast `30 0 * * 1,4` (Mon + Thu 06:00 IST), tracker `30 1 * * *`
  (07:00 IST daily).
