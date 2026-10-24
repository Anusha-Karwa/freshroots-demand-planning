/**
 * npm run zoho:sync-items [-- --limit 20] [-- --test-po]
 * Live mode only: finds or creates a Zoho item for each SKU (matched on the SKU code) and stores its item id.
 * --test-po also creates ONE draft purchase order for the first 2 SKUs against ZOHO_DEFAULT_VENDOR_ID.
 */
import "./_env";
import { eq } from "drizzle-orm";
import { closeDb, getDb, schema } from "@/db";
import { liveClient } from "@/lib/adapters/zoho";
import { todayIst } from "@/lib/dates";
import { missingVars } from "@/lib/integrations";

async function main() {
  const missing = missingVars("zoho");
  if (missing.length) throw new Error(`Zoho is in mock mode — set ${missing.join(", ")} in .env first.`);
  const i = process.argv.indexOf("--limit");
  const limit = i > 0 ? Number(process.argv[i + 1]) : Infinity;
  const db = await getDb();
  const client = liveClient(db);
  const skus = (await db.select().from(schema.skus).where(eq(schema.skus.active, true)).orderBy(schema.skus.id)).slice(0, limit);
  for (const sku of skus) {
    const id = await client.ensureItem(sku);
    await db.update(schema.skus).set({ zohoItemId: id }).where(eq(schema.skus.id, sku.id));
    console.log(`${sku.id}  →  Zoho item ${id}${sku.zohoItemId === id ? " (already linked)" : ""}`);
  }
  if (process.argv.includes("--test-po")) {
    const vendor = process.env.ZOHO_DEFAULT_VENDOR_ID?.trim();
    if (!vendor) throw new Error("Set ZOHO_DEFAULT_VENDOR_ID for the test PO.");
    const two = (await db.select().from(schema.skus).orderBy(schema.skus.id).limit(2));
    const po = await client.createDraftPurchaseOrder({
      vendorId: vendor, date: todayIst(), reference: "FR-TEST", notes: "Test draft from the Freshroots demand-planning setup. Safe to delete.",
      lines: two.map((s) => ({ skuId: s.id, name: s.name, unit: s.unit, qty: 1, rate: s.unitCost ?? 0, zohoItemId: s.zohoItemId })),
    }, async (l) => client.ensureItem({ id: l.skuId, name: l.name, unit: l.unit, unitCost: l.rate, unitPrice: null }));
    console.log(`Test PO ${po.number} created with status “${po.status}” (should be draft).`);
  }
  await closeDb();
}

main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
