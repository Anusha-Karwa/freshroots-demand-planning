# Zoho Inventory setup (India data centre)

Until these steps are done, purchase orders go to the `mock_zoho_purchase_orders` table and show **MOCK**.

## 1. In the browser (about 15 minutes)

1. Sign up at zoho.com/in/inventory (free plan is enough). Organisation `Freshroots (Demo)`, India, INR, Asia/Kolkata.
   Indian accounts live on the **India data centre**: every URL uses `.in`.
2. **Organisation ID**: Settings → Organization Profile → copy it → `ZOHO_ORGANIZATION_ID`.
3. **Test vendor**: Purchases → Vendors → New → `Freshroots Demo Supplier`. Open it; the number in the URL → `ZOHO_DEFAULT_VENDOR_ID`.
4. **API client**: api-console.zoho.in → Add Client → **Self Client** → Create. Copy Client ID / Secret →
   `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`.
5. **Grant code**: in the Self Client, *Generate Code* tab, scope (paste exactly):
   ```
   ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.items.CREATE,ZohoInventory.items.READ,ZohoInventory.contacts.READ,ZohoInventory.settings.READ
   ```
   Duration 10 minutes. Copy the code and do step 2 straight away.

## 2. In the terminal

```bash
npm run zoho:refresh-token -- <grant code>    # prints the refresh token once → ZOHO_REFRESH_TOKEN in .env (and Vercel)
npm run zoho:verify                            # token refresh + checks the organisation and default vendor
npm run zoho:sync-items -- --limit 20          # creates/links Zoho items for the first 20 SKUs, prints their ids
npm run zoho:sync-items -- --limit 2 --test-po # also creates ONE draft PO for 2 SKUs (delete it in Zoho afterwards)
```

Then the Integrations page shows **Zoho Inventory: Live** and its *Test* button lists your organisation.

## Errors and fixes

| Zoho says | Fix |
|---|---|
| `invalid_code` on the grant code | Expired (10 min) or used already: generate a new code |
| `invalid_code` on token refresh | Refresh token wrong or revoked: redo step 5 and `zoho:refresh-token` |
| `invalid_client` | Wrong client id/secret, or the account is not on the India DC (`ZOHO_ACCOUNTS_URL`) |
| `You are not authorized to perform this operation` / code 57 | A scope is missing: regenerate the grant code with the full scope list |
| `Vendor does not exist` | Wrong `ZOHO_DEFAULT_VENDOR_ID`, or map the supplier on the Purchase orders page |
| code 1070 / HTTP 429 | Rate limit: the client waits and retries automatically |

Every call is written to the `zoho_api_log` table and shown on the Purchase orders page.

## How the app uses Zoho

- **Draft only.** `POST /purchaseorders` creates a draft; the app never issues or sends a PO. Procurement confirms in Zoho.
- One PO per supplier (the SKU file's `Distributor_ID`), each mapped to a Zoho vendor on the Purchase orders page.
- A SKU without a Zoho item is created on the fly (matched on its SKU code), and the item id is stored.
- The daily job reads each draft's status back, so the dashboard shows when procurement has issued it.
