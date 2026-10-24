/** npm run zoho:verify → refreshes an access token and checks ZOHO_ORGANIZATION_ID is one of your organisations. */
import "./_env";
import { liveClient } from "@/lib/adapters/zoho";
import { missingVars } from "@/lib/integrations";

async function main() {
  const missing = missingVars("zoho");
  if (missing.length) throw new Error(`Missing in .env: ${missing.join(", ")}`);
  const client = liveClient();
  await client.accessToken();
  console.log("✓ access token refreshed");
  const orgs = await client.organizations();
  for (const o of orgs) console.log(`  organisation ${o.organization_id}: ${o.name}`);
  const mine = orgs.find((o) => o.organization_id === process.env.ZOHO_ORGANIZATION_ID?.trim());
  if (!mine) throw new Error("ZOHO_ORGANIZATION_ID is not in the list above.");
  console.log(`✓ ZOHO_ORGANIZATION_ID matches “${mine.name}”`);
  const vendor = process.env.ZOHO_DEFAULT_VENDOR_ID?.trim();
  if (vendor) {
    const r = await client.request<{ contact?: { contact_name: string } }>("GET", `/contacts/${vendor}`);
    console.log(`✓ ZOHO_DEFAULT_VENDOR_ID is “${r.contact?.contact_name}”`);
  } else console.log("! ZOHO_DEFAULT_VENDOR_ID not set (needed unless every supplier is mapped)");
}

main().catch((err) => {
  console.error(`✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
