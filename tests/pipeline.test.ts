import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * End to end on an in-memory Postgres (PGlite) with every integration in mock mode:
 * seed files → forecast run → Raghav's decisions → draft POs (mock Zoho) → daily tracker.
 */
process.env.PGLITE_DIR = "memory://";
for (const k of ["DATABASE_URL", "GEMINI_API_KEY", "ZOHO_CLIENT_ID", "RESEND_API_KEY"]) delete process.env[k];

const { getDb, closeDb, schema } = await import("@/db");
const { loadSeed } = await import("@/lib/data/load");
const { runForecast } = await import("@/lib/forecast/run");
const { decide, bulkApproveStockouts } = await import("@/lib/decisions");
const { createPurchaseOrders, linesToOrder } = await import("@/lib/purchase-orders");
const { runTracker } = await import("@/lib/tracker");
const { runBacktest } = await import("@/lib/backtest");

let db: Awaited<ReturnType<typeof getDb>>;
beforeAll(async () => { db = await getDb(); });
afterAll(async () => { await closeDb(); });

describe("pipeline on the supplied seed data", () => {
  it("loads all five files without rejections", async () => {
    const s = await loadSeed(db, "test");
    expect(s.map((x) => [x.kind, x.accepted, x.rejected.length])).toEqual([
      ["skus", 15, 0], ["prices", 15, 0], ["distributors", 4, 0], ["calendar", 24, 0], ["sales", 240, 0], ["inventory", 15, 0],
    ]);
  });

  it("runs the rules and routes flags to Raghav", async () => {
    const r = await runForecast(db, { trigger: "script", planningDate: "2026-10-24" });
    expect(r.dataThrough).toBe("2026-10-18");
    expect(r.reasonSource).toBe("template");
    expect(r.counts).toMatchObject({ skus: 15, review: 7, exceptions: 0, highDemand: 1, stockoutRisk: 5, overstockRisk: 2 });
  });

  it("orders only what Raghav approves, one draft PO per supplier", async () => {
    const items = await db.select().from(schema.runItems);
    const by = (sku: string) => items.find((i) => i.skuId === sku)!;
    expect(by("SKU001").recommendedQty).toBe(750); // high demand + stockout → 1.5 × 500
    await decide(db, { itemId: by("SKU001").id, decision: "approved", by: "Raghav" });
    await decide(db, { itemId: by("SKU006").id, decision: "rejected", reason: "new listing", by: "Raghav" });
    await expect(decide(db, { itemId: by("SKU003").id, decision: "edited", qty: 1, by: "Raghav" })).rejects.toThrow(/reason/);
    const n = await bulkApproveStockouts(db, { itemIds: items.map((i) => i.id), reviewed: true, by: "Raghav" });
    expect(n).toBe(4); // SKU003, 004, 011, 013 (SKU001 already decided)
    const lines = await linesToOrder(db);
    expect(lines.map((l) => l.skuId).sort()).toEqual(["SKU001", "SKU003", "SKU004", "SKU011", "SKU013"]);
    const r = await createPurchaseOrders(db, "Raghav");
    expect(r).toMatchObject({ created: 3, failed: 0 }); // suppliers DIST001, DIST002, DIST004
    expect(await linesToOrder(db)).toEqual([]); // can't be ordered twice
    const mock = await db.select().from(schema.mockZohoPurchaseOrders);
    expect(mock.map((m) => m.status)).toEqual(["draft", "draft", "draft"]);
    const emails = await db.select().from(schema.mockEmails);
    expect(emails.some((e) => e.subject.includes("draft purchase order"))).toBe(true);
  });

  it("runs the daily tracker and the backtest", async () => {
    const t = await runTracker(db, { today: "2026-10-24" });
    expect(t.checked).toBe(15);
    expect(t.killSwitch).toBe("green"); // 1 of 6 decided recommendations rejected = 17%
    const b = await runBacktest(db);
    expect(b.points).toBeGreaterThan(50);
    expect(b.weeksReplayed).toHaveLength(4);
  });
});
