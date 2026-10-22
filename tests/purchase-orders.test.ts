import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";
for (const k of ["DATABASE_URL", "GEMINI_API_KEY", "RESEND_API_KEY", "ZOHO_CLIENT_ID", "ZOHO_DEFAULT_VENDOR_ID", "PROCUREMENT_EMAIL", "VIEWER_EMAIL"]) delete process.env[k];

const { loadFiles } = await import("@/lib/seed/loader");
const { runForecast } = await import("@/lib/rules/run");
const { createDraftPOs, groupByVendor, readyLines, confirmMockPurchaseOrder } = await import("@/lib/purchase-orders");
const { notifyProcurement, notifyKillSwitch, notifyPlanner } = await import("@/lib/notify");
const { closeDb, getDb, schema } = await import("@/lib/db");
const { ensureDefaults } = await import("@/lib/settings");
const { DEFAULT_BASELINE } = await import("@/lib/config/baseline");
const { killSwitch } = await import("@/lib/killswitch");
const { eq } = await import("drizzle-orm");

const raghav = { name: "Raghav", role: "planner" as const };

beforeAll(async () => {
  await ensureDefaults();
  await loadFiles(
    {
      skus: "data/seed/skus.csv",
      distributors: "data/seed/distributors.csv",
      calendar: "data/seed/calendar.csv",
      weekly_sales: "data/seed/weekly_sales.csv",
      inventory: "data/seed/inventory.csv",
    },
    { source: "seed", replace: true, placeholderPricesFile: "data/placeholder_prices.csv" },
  );
});
afterAll(closeDb);

describe("groupByVendor", () => {
  const l = (skuId: string, vendorId: string | null, quantity: number) =>
    ({ source: "recommendation" as const, id: 1, skuId, name: skuId, vendorId, zohoItemId: null, quantity, unitCost: 10, priceSource: "file" });
  it("one group per supplier, mapped to Zoho vendors, skipping zero quantities", () => {
    const g = groupByVendor([l("A", "S1", 5), l("B", "S2", 3), l("C", "S1", 2), l("D", null, 1), l("E", "S1", 0)], { S1: "Z-1" }, "Z-DEF");
    expect(g.map((x) => [x.supplierId, x.zohoVendorId, x.lines.map((y) => y.skuId)])).toEqual([
      ["DEFAULT", "Z-DEF", ["D"]],
      ["S1", "Z-1", ["A", "C"]],
      ["S2", "Z-DEF", ["B"]],
    ]);
    expect(g[1].totalValue).toBe(70);
  });
});

describe("draft PO flow (mock Zoho, mock email)", () => {
  it("emails Raghav after a run", async () => {
    const run = await runForecast("cron");
    expect((await notifyPlanner(run))?.mode).toBe("mock");
  });

  it("turns approved lines (not rejected, not zero) into one draft per supplier, once", async () => {
    const db = await getDb();
    const recs = await db.select().from(schema.recommendations);
    // approve all, then reject SKU003 and edit SKU001 down
    for (const r of recs) await db.update(schema.recommendations).set({ status: "approved", finalQty: r.recommendedQty }).where(eq(schema.recommendations.id, r.id));
    await db.update(schema.recommendations).set({ status: "rejected", finalQty: 0 }).where(eq(schema.recommendations.skuId, "SKU003"));
    await db.update(schema.recommendations).set({ status: "edited", finalQty: 600 }).where(eq(schema.recommendations.skuId, "SKU001"));

    const ready = await readyLines();
    // SKU006 / SKU007 are "pause" (qty 0) and SKU003 is rejected → not ordered
    expect(ready.lines.map((l) => [l.skuId, l.quantity]).sort()).toEqual([["SKU001", 600], ["SKU004", 150], ["SKU011", 500], ["SKU013", 120]]);

    const pos = await createDraftPOs(raghav);
    // suppliers from the SKU file: SKU001/SKU013 → DIST001, SKU004 → DIST002, SKU011 → DIST004
    expect(pos.map((p) => [p.supplierId, p.lines, p.status])).toEqual([["DIST001", 2, "draft"], ["DIST002", 1, "draft"], ["DIST004", 1, "draft"]]);
    expect(pos.every((p) => p.number?.startsWith("MOCK-PO-"))).toBe(true);

    const mock = await db.select().from(schema.mockZohoPurchaseOrders);
    expect(mock).toHaveLength(3);
    expect((mock[0].payload as { line_items: unknown[] }).line_items).toHaveLength(2);

    await expect(createDraftPOs(raghav)).rejects.toThrow(/No approved lines/);
    expect((await notifyProcurement(pos, "Raghav"))?.mode).toBe("mock");
  });

  it("lets mock procurement confirm a draft", async () => {
    const db = await getDb();
    const [po] = await db.select().from(schema.purchaseOrders).limit(1);
    await confirmMockPurchaseOrder(po.id);
    const [after] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, po.id));
    expect(after.status).toBe("issued");
  });

  it("emails Deepa only when the kill switch turns red", async () => {
    const red = killSwitch([{ runId: 1, decided: 10, overridden: 9 }], [], DEFAULT_BASELINE);
    const green = killSwitch([{ runId: 1, decided: 10, overridden: 0 }], [], DEFAULT_BASELINE);
    expect(await notifyKillSwitch(green)).toBeNull();
    expect((await notifyKillSwitch(red))?.mode).toBe("mock");
    expect(await notifyKillSwitch(red)).toBeNull(); // still red: no repeat email
    const db = await getDb();
    const mails = await db.select().from(schema.mockEmails);
    expect(mails.map((m) => m.subject)).toEqual([
      expect.stringMatching(/awaiting your call/),
      expect.stringMatching(/draft purchase orders ready/),
      "Freshroots demand planning: kill switch is RED",
    ]);
  });
});
