import "./_env";
import { eq, isNull } from "drizzle-orm";
import { closeDb, getDb, schema } from "../src/lib/db";
import { integrationMode } from "../src/lib/integrations";
import { createItem } from "../src/lib/adapters/zoho";

/**
 * Creates a Zoho Inventory item for every SKU that doesn't have a zoho_item_id yet, and stores the id.
 *   npm run zoho:sync-items              all missing SKUs
 *   npm run zoho:sync-items -- --limit 20   a test batch
 * Live mode only.
 */
if (integrationMode("zoho") !== "live") {
  console.error("Zoho is in mock mode (ZOHO_* vars missing) — nothing to sync.");
  process.exit(1);
}
const i = process.argv.indexOf("--limit");
const limit = i >= 0 ? Number(process.argv[i + 1]) : Infinity;
const db = await getDb();
const missing = (await db.select().from(schema.skus).where(isNull(schema.skus.zohoItemId)).orderBy(schema.skus.skuId)).slice(0, limit);
console.log(`Creating ${missing.length} item(s) in Zoho…`);
let ok = 0;
for (const s of missing) {
  try {
    const id = await createItem(s);
    await db.update(schema.skus).set({ zohoItemId: id }).where(eq(schema.skus.skuId, s.skuId));
    console.log(`  ${s.skuId} → ${id}`);
    ok++;
  } catch (err) {
    console.error(`  ${s.skuId} failed: ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`Done: ${ok}/${missing.length}.`);
await closeDb();
