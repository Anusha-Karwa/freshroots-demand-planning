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
    calendar: write("calendar.csv", `week_start,is_festival\n2026-06-01,N\n2026-06-08,N\n2026-06-15,N\n2026-06-22,N`),
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
2026-06-22,A,D1,11`,
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
    expect(s.rejected).toBe(3);
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
    expect((await db.select().from(schema.rejectedRows)).length).toBe(5);
  });
});
