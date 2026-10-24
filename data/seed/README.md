# Seed data

The five seed files (synthetic, supplied for the case — not real customer data):

| File | Contents |
|---|---|
| `calendar.csv` | One row per month: Year, Month, Year_Month, Is_Festival_Month |
| `skus.csv` | SKU_ID, SKU_Name, Category, Perishability, Standard_Reorder_Qty, Unit_of_Measure, Distributor_ID (= supplier) |
| `distributors.csv` | Distributor_ID, Distributor_Name, Region, Status |
| `inventory.csv` | SKU_ID, Location, Units_On_Hand, As_Of_Date |
| `weekly_sales.csv` | SKU_ID, Week (ISO week), Units_Sold |

`../placeholder_prices.csv` adds a made-up unit cost and price per SKU until real prices are loaded.
An optional `planner_history.csv` (Week, SKU, Flag) here is loaded too, for the backtest's agreement score.

```bash
npm run seed -- --inspect   # show the columns found in each file and how they map
npm run seed                # load them (prints row counts and any rejected rows)
npm run seed -- --sales other.csv   # use another file for one kind
```
