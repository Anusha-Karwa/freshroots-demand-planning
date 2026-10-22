# Assumptions

Decisions made without asking. Each one is easy to change; say so if any is wrong.

## Inputs not yet in the repo
- **Case PDF and components map** (`MESA_Case 01 - 22 Oct.pdf`, `Freshroots_Components_Map_v2.png`) were not
  provided with the build prompt. Phase 1 follows the prompt's own summary of the case and its components table.
  Drop both into `docs/` and the later phases will be checked against them.
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
- Rules and the baseline/kill-switch numbers live in the database (`rules_config_versions`, `app_settings`),
  seeded from `src/lib/config/*.ts` defaults. Nothing is hard-coded in the engine.
- Kill-switch outcome threshold is stored as ₹11 L/month (as written in the prompt) rather than derived
  from ₹34 L ÷ 3 = ₹11.3 L.

## Product
- Two extra env vars beyond the prompt's list: `VIEWER_PASSWORD` (read-only login for Deepa/CEO, the
  `viewer` role) and `VIEWER_EMAIL` (where the red kill-switch alert goes).
- With no `DASHBOARD_PASSWORD`, local dev skips login and treats everyone as the planner.
- Vercel Cron schedules are in UTC: forecast `30 0 * * 1,4` (Mon + Thu 06:00 IST), tracker `30 1 * * *`
  (07:00 IST daily).
