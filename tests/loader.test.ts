import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

process.env.PGLITE_DIR = "memory://";
delete process.env.DATABASE_URL;

const { loadFiles } = await import("@/lib/seed/loader");
const { closeDb, getDb, schema } = await import("@/lib/db");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seed-test-"));
const write = (name: string, body: string) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, body.trim() + "\n");
  return p;
};

let report: Awaited<ReturnType<typeof loadFiles>>;

beforeAll(async () => {
  const files = {
    calendar: write("calendar.csv", `Year,Month,Is_Festival_Month\n2026,6,FALSE\n2026,10,TRUE\n2026,11,TRUE\n2027,3,TRUE`),
    skus: write("skus.csv", `sku_id,name,is_perishable,standard_order_qty\nA,Atta,N,100\nB,Paneer,Y,50\nC,Bad,N,0`),
    distributors: write("distributors.csv", `distributor_id,name\nD1,One\nD2,Two`),
    weekly_sales: write(
      "weekly_sales.csv",
      `week_start,sku_id,distributor_id,units
2026-06-01,A,D1,10
2026-06-01,A,D2,5
2026-06-08,A,D1,12
2026-06-22,A,D1,9
2026-06-22,Z,D1,9
2026-06-22,A,D9,9
2026-06-22,B,D1,abc
2026-06-22,A,D1,11
2026-08-03,A,D1,7`,
    ),
    inventory: write("inventory.csv", `sku_id,stock_on_hand\nA,100\nB,-5`),
  };
  report = await loadFiles(files, { source: "seed", replace: true });
});

afterAll(async () => {
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const file = (t: string) => report.files.find((f) => f.type === t)!;
const check = (prefix: string) => report.checks.find((c) => c.name.startsWith(prefix))!;

describe("seed loader", () => {
  it("rejects SKUs with a non-positive standard order qty", () => {
    expect(file("skus").accepted).toBe(2);
    expect(file("skus").rejected).toBe(1);
  });

  it("rejects sales rows with unknown SKU / distributor / bad number", () => {
    const s = file("weekly_sales");
    expect(s.rejectionsByReason['unknown SKU "…"']).toBe(1);
    expect(s.rejectionsByReason['unknown distributor "…"']).toBe(1);
    expect(s.rejectionsByReason["week 2026-08-03 falls in 2026-08, which is not in the calendar"]).toBe(1);
    expect(s.rejected).toBe(4);
    expect(check("Every sales row's SKU").passed).toBe(false);
  });

  it("keeps the last of duplicate rows and counts the duplicate", () => {
    expect(file("weekly_sales").duplicates).toBe(1);
  });

  it("flags the missing week", () => {
    const c = check("No missing weeks");
    expect(c.passed).toBe(false);
    expect(c.detail).toContain("2026-06-15");
  });

  it("rejects negative stock and defaults the snapshot date to the day after the last sales week", async () => {
    expect(file("inventory").rejectionsByReason["negative stock"]).toBe(1);
    const db = await getDb();
    const rows = await db.select().from(schema.inventorySnapshots);
    expect(rows).toEqual([expect.objectContaining({ skuId: "A", stockOnHand: 100, snapshotDate: "2026-06-29" })]);
  });

  it("builds SKU-level weekly totals", async () => {
    const db = await getDb();
    const rows = await db.select().from(schema.skuWeeklySales);
    const w1 = rows.find((r) => r.weekStart === "2026-06-01")!;
    expect(w1).toMatchObject({ skuId: "A", units: 15, distributorCount: 2 });
    expect(rows.find((r) => r.weekStart === "2026-06-22")!.units).toBe(11);
  });

  it("stores rejected rows for review", async () => {
    const db = await getDb();
    expect((await db.select().from(schema.rejectedRows)).length).toBe(6);
  });
});

describe("seed loader — product-level sales, monthly calendar, placeholder prices", () => {
  it("loads sales without a distributor column and fills placeholder prices", async () => {
    const files = {
      calendar: write("cal2.csv", `Year,Month,Year_Month,Is_Festival_Month\n2026,6,2026-06,FALSE\n2026,7,2026-07,FALSE\n2026,3,2026-03,TRUE\n2026,10,2026-10,TRUE\n2026,11,2026-11,TRUE`),
      skus: write("sku2.csv", `SKU_ID,SKU_Name,Category,Perishability,Standard_Reorder_Qty,Distributor_ID\nS1,Milk,Dairy,High,150,D1\nS2,Rice,Staple,Low,300,D2`),
      distributors: write("dist2.csv", `Distributor_ID,Distributor_Name,Region,Status\nD1,One,MH,Active\nD2,Two,MH,Active`),
      weekly_sales: write("sales2.csv", `SKU_ID,Week,Units_Sold\nS1,2026-W27,10\nS1,2026-W28,12\nS2,2026-W27,5\nS2,2026-W29,6`),
      inventory: write("inv2.csv", `SKU_ID,Location,Units_On_Hand,As_Of_Date\nS1,Pune,40,2026-07-20\nS2,Pune,90,2026-07-20`),
    };
    const prices = write("prices.csv", `sku_id,unit_cost,unit_price\nS1,30,40`);
    const rep = await loadFiles(files, { source: "seed", replace: true, placeholderPricesFile: prices });
    expect(rep.blocked).toBe(false);
    expect(rep.files.find((f) => f.type === "weekly_sales")!.accepted).toBe(4);

    const db = await getDb();
    const sku = await db.select().from(schema.skus);
    expect(sku.find((s) => s.skuId === "S1")).toMatchObject({ isPerishable: true, standardOrderQty: 150, vendorId: "D1", unitCost: 30, priceSource: "placeholder" });
    expect(sku.find((s) => s.skuId === "S2")).toMatchObject({ isPerishable: false, priceSource: null });

    const weekly = await db.select().from(schema.skuWeeklySales);
    expect(weekly.find((w) => w.skuId === "S1" && w.weekStart === "2026-06-29")).toMatchObject({ units: 10, distributorCount: 0 });

    const c = (p: string) => rep.checks.find((x) => x.name.startsWith(p))!;
    expect(c("Every sales row's distributor").detail).toContain("n/a");
    expect(c("No missing weeks within each SKU").passed).toBe(false); // S2 skips W28
    expect(c("Calendar festival months match").passed).toBe(true);
    expect(c("Every SKU has a unit cost").passed).toBe(false);
  });
});
