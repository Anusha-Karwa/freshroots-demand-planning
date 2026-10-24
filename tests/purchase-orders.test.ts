import { describe, it, expect } from "vitest";
import { groupBySupplier, type OrderLine } from "@/lib/purchase-orders";

const line = (sku: string, supplier: string): OrderLine => ({
  itemId: Math.random(), skuId: sku, name: sku, unit: "Units", supplierId: supplier, qty: 10, rate: 5, zohoItemId: null, placeholderPrice: false,
});

describe("one draft PO per supplier", () => {
  const lines = [line("A", "S1"), line("B", "S2"), line("C", "S1")];
  it("groups lines and maps vendors (map, then default)", () => {
    const g = groupBySupplier(lines, { S1: "V1" }, "VDEF", true);
    expect(g.map((x) => [x.supplierId, x.vendorId, x.lines.map((l) => l.skuId)])).toEqual([["S1", "V1", ["A", "C"]], ["S2", "VDEF", ["B"]]]);
  });
  it("leaves the vendor empty in live mode when nothing maps (the PO fails visibly)", () => {
    expect(groupBySupplier(lines, {}, undefined, true)[0].vendorId).toBeNull();
  });
  it("uses a mock vendor in mock mode", () => {
    expect(groupBySupplier(lines, {}, undefined, false)[0].vendorId).toBe("MOCK-VENDOR-S1");
  });
});
