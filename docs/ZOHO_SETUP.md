# Zoho Inventory setup (India data centre)

Do these in the browser (about 15 minutes), then the refresh-token step from a terminal.

1. Sign up at zoho.com/in/inventory. Organisation `Freshroots (Demo)`, India, INR, Asia/Kolkata.
   All URLs use `.in` (accounts.zoho.in, zohoapis.in).
2. Settings → Organization Profile → copy the **Organization ID** → `ZOHO_ORGANIZATION_ID`.
3. Purchases → Vendors → New: `Freshroots Demo Supplier`. Copy the ID from the URL → `ZOHO_DEFAULT_VENDOR_ID`.
4. api-console.zoho.in → Add Client → **Self Client** → copy Client ID / Secret → `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`.
5. Self Client → Generate Code, scope:
   `ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.items.CREATE,ZohoInventory.items.READ,ZohoInventory.contacts.READ,ZohoInventory.settings.READ`
   — duration 10 minutes. Within those 10 minutes run `npm run zoho:refresh-token -- <code>` and put the
   printed value in `.env` (and Vercel) as `ZOHO_REFRESH_TOKEN`.
6. On the app's Purchase orders page, map each supplier (DIST001…) to its Zoho vendor id.
7. Optional: `npm run zoho:sync-items -- --limit 20` creates Zoho items for the SKUs (so PO lines link to items).
8. The Integrations page shows Zoho as Live once all ZOHO_* variables are set.

Purchase orders are always created as **drafts**; procurement confirms them inside Zoho.
