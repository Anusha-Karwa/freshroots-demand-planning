# SAP export format

The IT team uploads the SAP export on the **Data** page (Upload → map columns → load), before the Mon/Thu
06:00 IST run. Headers don't have to match: common SAP names are recognised, and the mapping step covers the rest.
Uploads **add to / update** what is loaded; for sales, a file replaces the week × SKU combinations it contains.

**General:** CSV, UTF-8, one header row. Excel → *Save As → CSV UTF-8*. Dates as `YYYY-MM-DD`, `DD-MM-YYYY`,
`DD/MM/YYYY`, `DD.MM.YYYY`, `YYYYMMDD` or an ISO week (`2026-W27` = that week's Monday). Numbers may contain `₹`,
`Rs.` and Indian thousands separators (`1,23,456.50`); SAP's trailing minus (`120-`) and `(120)` read as negative.

## 1. Weekly sales — one row per week × SKU × distributor

| Field | Required | Recognised headers | Notes |
|---|---|---|---|
| Week | yes | Week, Week_Start, Posting_Week, Billing_Date, Date | Any date in the week works; it is snapped to the Monday |
| SKU | yes | SKU_ID, SKU, Material, Material_Code, Item_Code | Must be in the SKU master |
| Distributor | recommended | Distributor_ID, Customer, Customer_Code, Sold_To | Must be in the distributor master. Without it, sales are SKU-level and the single-distributor exception (rule 6b) is off |
| Units | yes | Units_Sold, Units, Qty, Billed_Qty, Quantity | Decimals allowed; negative = net returns |

Several rows for the same week × SKU × distributor (e.g. one per billing line) are **added together**.

## 2. Stock on hand

| Field | Required | Recognised headers | Notes |
|---|---|---|---|
| SKU | yes | SKU_ID, Material, Item_Code | |
| Units on hand | yes | Units_On_Hand, Stock_On_Hand, SOH, Unrestricted_Stock, Closing_Stock | Must be ≥ 0 |
| As-of date | no | As_Of_Date, Snapshot_Date, Stock_Date | Default: the day after the latest sales week |
| Location | no | Location, Plant, Warehouse, Storage_Location | Stock is summed across locations |

Weekly stock snapshots (one file per week) also let the backtest replay the stockout/overstock flags.

## 3. Masters (only when they change)

- **SKUs**: SKU_ID, SKU_Name, **Perishability** (High/Low or Y/N), **Standard_Reorder_Qty** (> 0) are required —
  the rules cannot run without the last two. Optional: Category, Unit_of_Measure, Distributor_ID (= the supplier,
  mapped to a Zoho vendor), Unit_Cost, Unit_Price (replace the placeholder prices).
- **Distributors**: Distributor_ID, Distributor_Name; optional Region, Status.
- **Calendar**: Year_Month (or Year + Month), Is_Festival_Month; optional Festival_Name, Competitor_Scheme.
  The rules use the festival months on the Rules page; the calendar is context for Gemini.
- **Raghav's past recommendations** (optional, for the backtest's agreement score): Week, SKU, Flag
  (`HIGH_DEMAND`, `STOCKOUT_RISK`, `OVERSTOCK_RISK` or `NONE`).

## Validation

Rejected rows are listed with their row number and reason: missing/unreadable values, a SKU or distributor not in
the masters, negative stock, perishability or order quantity the rules can't use. Warnings (loaded anyway): missing
weeks (they read as zero sales), a newest week that covers only some SKUs, sales in months missing from the calendar,
SKUs without a stock figure (they go to the exceptions queue).

## Suggested SAP sources

- Sales: billing documents (VBRK/VBRP) summed by ISO week, material and sold-to party.
- Stock: MB52 / MARD unrestricted stock by material (all storage locations).
