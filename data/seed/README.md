# Seed data

Put the five seed files here as CSV (UTF-8, header row). Default file names:

| File | Contents |
|---|---|
| `calendar.csv` | One row per month: year, month, festival flag (competitor schemes optional) |
| `skus.csv` | The 400 SKUs |
| `distributors.csv` | The 1,200 distributors |
| `inventory.csv` | Current stock on hand per SKU |
| `weekly_sales.csv` | Weekly sales by SKU × distributor |

Other names work too: `npm run seed -- --skus path/to/file.csv`.

The current files are synthetic seed data supplied for the case (not real customer data).

Before loading, run `npm run seed -- --inspect` to see the columns found in each file and
how they map to the database.
