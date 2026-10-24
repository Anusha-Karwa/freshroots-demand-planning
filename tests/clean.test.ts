import { describe, it, expect } from "vitest";
import { cleanInventory, cleanSales, cleanSkus, missingWeeks } from "@/lib/data/clean";
import { autoMap } from "@/lib/data/columns";

const rows = (csv: string) => {
  const [head, ...lines] = csv.trim().split("\n");
  const h = head.split(",");
  return { headers: h, rows: lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [h[i], v]))) };
};

describe("SKU master", () => {
  it("rejects rows the rules can't use", () => {
    const { headers, rows: r } = rows(`SKU_ID,SKU_Name,Perishability,Standard_Reorder_Qty
SKU1,Juice,High,100
SKU2,Bread,Unknown,100
SKU3,Rice,Low,0
,Nameless,Low,5`);
    const c = cleanSkus(r, autoMap("skus", headers));
    expect(c.records.map((s) => s.id)).toEqual(["SKU1"]);
    expect(c.records[0].perishable).toBe(true);
    expect(c.rejected.map((x) => x.row)).toEqual([3, 4, 5]);
  });
});

describe("sales", () => {
  const ctx = { knownSkus: new Set(["SKU1", "SKU2"]), knownDistributors: new Set(["D1"]) };
  it("checks every SKU and distributor exists, and adds up duplicate lines", () => {
    const { headers, rows: r } = rows(`sku,week,distributor,units
SKU1,2026-W27,D1,10
SKU1,2026-W27,D1,5
SKU9,2026-W27,D1,1
SKU1,2026-W27,D9,1
SKU1,bad,D1,1`);
    const c = cleanSales(r, autoMap("sales", headers), ctx);
    expect(c.records).toEqual([{ weekStart: "2026-06-29", skuId: "SKU1", distributorId: "D1", units: 15 }]);
    expect(c.rejected.map((x) => x.reason)).toEqual([
      "SKU9: not in the SKU master", "D9: not in the distributor master", 'week "bad" not understood',
    ]);
    expect(c.warnings.join(" ")).toContain("added together");
  });
  it("uses distributor ALL when the file has no distributor column", () => {
    const { headers, rows: r } = rows(`SKU_ID,Week,Units_Sold\nSKU1,2026-W27,10`);
    expect(cleanSales(r, autoMap("sales", headers), ctx).records[0].distributorId).toBe("ALL");
  });
  it("finds missing weeks overall and per SKU", () => {
    const w = missingWeeks([
      { weekStart: "2026-06-29", skuId: "A" }, { weekStart: "2026-07-13", skuId: "A" },
      { weekStart: "2026-06-29", skuId: "B" }, { weekStart: "2026-07-06", skuId: "B" }, { weekStart: "2026-07-13", skuId: "B" },
    ]);
    expect(w.join(" ")).toContain("A (1)");
    expect(missingWeeks([{ weekStart: "2026-06-29", skuId: "A" }, { weekStart: "2026-07-13", skuId: "A" }])[0]).toContain("Missing weeks in the file: 2026-07-06");
  });
});

describe("stock", () => {
  it("rejects negative stock and unknown SKUs; defaults the date", () => {
    const { headers, rows: r } = rows(`SKU_ID,Units_On_Hand\nSKU1,100\nSKU2,-5\nSKU9,3`);
    const c = cleanInventory(r, autoMap("inventory", headers), { knownSkus: new Set(["SKU1", "SKU2"]), defaultAsOf: "2026-10-19" });
    expect(c.records).toEqual([{ skuId: "SKU1", asOf: "2026-10-19", location: "ALL", units: 100 }]);
    expect(c.rejected.map((x) => x.reason)).toEqual(["SKU2: negative stock (-5)", "SKU9: not in the SKU master"]);
    expect(c.warnings.join(" ")).toContain("SKU2");
  });
});
