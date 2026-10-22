# Assumptions

Decisions made without asking. Each one is easy to change; say so if any is wrong.

## Inputs not yet in the repo
- **Case PDF and components map** (`MESA_Case 01 - 22 Oct.pdf`, `Freshroots_Components_Map_v2.png`) were not
  provided with the build prompt. Phase 1 follows the prompt's own summary of the case and its components table.
  Drop both into `docs/` and the later phases will be checked against them.
- **Seed data** has not arrived. `data/sample/` is a 5-SKU / 3-distributor / 20-week placeholder used only to
  test code. It will be deleted after the real files load.

## Data & database
- **Local database without `DATABASE_URL` is PGlite** (real Postgres compiled to WASM, stored in `./.data/pglite`)
  rather than SQLite. Same SQL dialect as Neon/Supabase in production, one schema, one set of migrations,
  no Docker. Limitation: only one process can open it at a time — stop `npm run dev` before `npm run seed`.
- **ORM is Drizzle** (the prompt allowed Prisma or Drizzle). Drizzle supports both PGlite and node-postgres
  from one schema; Prisma would need separate SQLite/Postgres schemas.
- **Seed files are CSV** with a header row. Excel files should be saved as CSV first.
- **A week is identified by its start date** (`week_start`, normally a Monday). "No missing weeks" means every
  7-day step between the first and last sales week has at least one sales row, and every calendar week in
  that range has sales.
- **Sales/stock quantities are decimals** (numeric), since SAP exports can carry kg/litre units.
- **Negative sales units are accepted** (returns/credit notes); only negative *stock* is rejected, as the prompt asks.
- **Duplicate rows** (same week × SKU × distributor) — the last one in the file wins; duplicates are counted
  in the summary.
- **Inventory without a date column** is treated as a snapshot taken the day after the last sales week.
- **`npm run seed` is a full reload**: it clears master data, sales and stock first (run history,
  decisions and POs are kept). The SAP CSV upload (phase 3) upserts on top instead.
- **SKU rows with standard order qty ≤ 0 are rejected**, since the 1.5× rule needs a positive quantity.
- **Seed files are git-ignored** (`data/seed/*`) so large or sensitive data never lands in the repo by accident.
  Say if you want the synthetic files committed.

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
