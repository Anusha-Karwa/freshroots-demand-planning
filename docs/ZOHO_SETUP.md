# Zoho Inventory setup (India data centre)

Do these in the browser (about 15 minutes), then the refresh-token step from a terminal.

1. Sign up at zoho.com/in/inventory. Organisation `Freshroots (Demo)`, India, INR, Asia/Kolkata.
   All URLs use `.in` (accounts.zoho.in, zohoapis.in).
2. Settings → Organization Profile → copy the **Organization ID** → `ZOHO_ORGANIZATION_ID`.
3. Purchases → Vendors → New: `Freshroots Demo Supplier`. Copy the ID from the URL → `ZOHO_DEFAULT_VENDOR_ID`.
4. api-console.zoho.in → Add Client → **Self Client** → copy Client ID / Secret → `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`.
5. Self Client → Generate Code, scope:
   `ZohoInventory.purchaseorders.CREATE,ZohoInventory.purchaseorders.READ,ZohoInventory.items.CREATE,ZohoInventory.items.READ,ZohoInventory.contacts.READ,ZohoInventory.settings.READ`
   — duration 10 minutes. Use the code within 10 minutes to get a refresh token (script added in phase 5)
   and put it in `.env` as `ZOHO_REFRESH_TOKEN`.

Purchase orders are always created as **drafts**; procurement confirms them inside Zoho.
