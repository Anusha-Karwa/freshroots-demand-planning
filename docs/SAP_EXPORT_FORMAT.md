# SAP export format

The IT team's SAP export replaces the seed data by uploading CSVs on the **Data** page (phase 3), or by
dropping them into `data/seed/` and running `npm run seed`. Column names do not have to match exactly —
the loader matches common SAP names (e.g. `Material`, `Sold-to`, `Unrestricted stock`) and the upload page
has a mapping step for anything else.

**General:** CSV, UTF-8, comma-separated, one header row. Dates as `YYYY-MM-DD`, `DD-MM-YYYY`, `DD.MM.YYYY`,
`YYYYMMDD`, or an ISO week (`2026-W27`, read as that week's Monday). Numbers may contain `₹` and thousands separators (`1,23,456.50`).

## 1. Weekly sales (`weekly_sales.csv`) — sales by SKU × distributor × week

| Field | Required | Accepted header names | Notes |
|---|---|---|---|
| week start | yes | week_start, week, posting_week, week_beginning | First day of the week (Monday) |
| SKU | yes | sku_id, sku, material, material_code, item_code | Must exist in the SKU master |
| distributor | no, but recommended | distributor_id, customer, customer_code, sold_to | Must exist in the distributor master. Without it sales are per SKU only and the distributor-concentration exception (rule 6b) is off |
| units | yes | units, units_sold, qty, quantity, billed_qty | Decimals allowed; negative = returns |
| value (₹) | no | value, sales_value, net_value, amount | |

## 2. Stock on hand (`inventory.csv`)

| Field | Required | Accepted header names | Notes |
|---|---|---|---|
| SKU | yes | sku_id, material, item_code | |
| stock on hand | yes | stock_on_hand, soh, unrestricted_stock, closing_stock | Must be ≥ 0 |
| snapshot date | no | snapshot_date, as_of, stock_date | Default: day after last sales week |
| location | no | location, plant, warehouse, storage_location | Default `ALL`; stock is summed across locations |

## 3. Masters (only when they change)

**SKUs (`skus.csv`)**: sku_id, name, **is_perishable** (Y/N or High/Low), **standard_order_qty** (> 0; also
read from `Standard_Reorder_Qty`) are required — the rules cannot run without the last two. Optional:
category, unit_cost, unit_price, vendor_id (the supplier; also read from `Distributor_ID`), launch_date, active.

**Distributors (`distributors.csv`)**: distributor_id, name required; district, region, state, active optional.

**Calendar (`calendar.csv`)**: one row per month — year and month required; is_festival (also
`Is_Festival_Month`), festival_name, competitor_scheme optional. A sales week counts in the month its
Thursday falls in.

## Validation on load
Rows are rejected (and listed with row number and reason) when: a required value is missing or unreadable,
a sales row's SKU or distributor is unknown, a sales week's month is not in the calendar, or stock is negative.
The load summary also flags missing weeks.

## Suggested SAP sources
- Sales: billing documents (VBRK/VBRP) aggregated by ISO week, material and sold-to party.
- Stock: MARD/MB52 unrestricted stock by material, summed across storage locations.
