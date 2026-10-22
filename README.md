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
| 1 | Scaffold, `.env.example`, DB schema, seed loader, mock adapters, Integrations page | ✅ done |
| 2 | Rules engine + unit tests + backtest page | next |
| 3 | Dashboard: overview, review queue, exceptions, rules config, SAP CSV upload | |
| 4 | Gemini explanations, decision log, tracker, kill-switch panel | |
| 5 | Zoho draft PO flow, Resend emails, cron endpoints | |
| 6 | Full README, deploy guide, case-requirements mapping | |

## Quick start (no API keys needed)

```bash
npm install
npm run seed            # loads data/seed/*.csv (or: npm run seed:sample for the 5-SKU placeholder)
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

Validation: every sales row's SKU and distributor must exist; no negative stock; no missing weeks.
Rejected rows are listed with row number and reason, and stored in the `rejected_rows` table.
Header names are matched flexibly; to support a new header, add it to `aliases` in
`src/lib/seed/columns.ts`. The SAP export format is in [`docs/SAP_EXPORT_FORMAT.md`](docs/SAP_EXPORT_FORMAT.md).

## Integrations

Every external service has a mock mode that switches on automatically when its keys are missing; see the
**Integrations** page. Variables are listed with where to get them in [`.env.example`](.env.example).

| Service | Mock behaviour |
|---|---|
| Postgres | PGlite in `./.data/pglite` |
| Gemini | Template-based reasons from the rule numbers |
| Zoho Inventory | Draft POs in `mock_zoho_purchase_orders`, labelled MOCK |
| Resend | Emails logged to console + `mock_emails` |

## Project layout

```
src/lib/db/schema.ts       all tables (Drizzle); migrations in drizzle/
src/lib/config/            rules + baseline defaults (editable at runtime, versioned in the DB)
src/lib/seed/              column mapping, parsing, loader + validation
src/lib/adapters/          gemini, zoho, email — live or mock
src/lib/integrations.ts    live/mock detection
scripts/                   seed, db-migrate
tests/                     vitest
```

Schema changes: edit `src/lib/db/schema.ts`, run `npm run db:generate`, commit the new file in `drizzle/`.
Migrations apply automatically on first database use.

See [`ASSUMPTIONS.md`](ASSUMPTIONS.md) for decisions made along the way.
