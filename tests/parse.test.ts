import { describe, expect, it } from "vitest";
import { addDays, missingWeeks, parseBool, parseDate, parseNumber } from "@/lib/seed/parse";
import { mapColumns } from "@/lib/seed/columns";

describe("parseDate", () => {
  it.each([
    ["2026-10-12", "2026-10-12"],
    ["12-10-2026", "2026-10-12"],
    ["12/10/2026", "2026-10-12"],
    ["12.10.2026", "2026-10-12"],
    ["20261012", "2026-10-12"],
    ["2026-10-12T00:00:00Z", "2026-10-12"],
    ["2026-W27", "2026-06-29"],
    ["2026-W42", "2026-10-12"],
    ["2026W01", "2025-12-29"],
    ["2020-W53", "2020-12-28"],
  ])("%s → %s", (raw, iso) => expect(parseDate(raw)).toEqual({ ok: true, value: iso }));

  it("rejects impossible dates", () => {
    expect(parseDate("31-02-2026").ok).toBe(false);
    expect(parseDate("next monday").ok).toBe(false);
    expect(parseDate("2025-W53").ok).toBe(false); // 2025 has 52 ISO weeks; 2026 has 53
    expect(parseDate("2026-W00").ok).toBe(false);
  });
});

describe("parseNumber / parseBool", () => {
  it("strips ₹ and Indian digit grouping", () => {
    expect(parseNumber("₹1,23,456.50")).toEqual({ ok: true, value: 123456.5 });
  });
  it("reads perishability-style flags", () => {
    expect(parseBool("High")).toEqual({ ok: true, value: true });
    expect(parseBool("Y")).toEqual({ ok: true, value: true });
    expect(parseBool("low")).toEqual({ ok: true, value: false });
    expect(parseBool("maybe").ok).toBe(false);
  });
});

describe("missingWeeks", () => {
  it("finds gaps on a 7-day grid", () => {
    const weeks = ["2026-06-01", "2026-06-08", "2026-06-22"];
    expect(missingWeeks(weeks)).toEqual(["2026-06-15"]);
  });
  it("returns nothing for a continuous range", () => {
    const weeks = Array.from({ length: 10 }, (_, i) => addDays("2026-06-01", i * 7));
    expect(missingWeeks(weeks)).toEqual([]);
  });
});

describe("mapColumns", () => {
  it("matches aliases case/space-insensitively", () => {
    const m = mapColumns("skus", ["Material Code", "Material Description", "Perishability", "MOQ", "Brand"]);
    expect(m.mapped).toMatchObject({ skuId: "Material Code", name: "Material Description", isPerishable: "Perishability", standardOrderQty: "MOQ" });
    expect(m.missingRequired).toEqual([]);
    expect(m.unmapped).toEqual(["Brand"]);
  });
  it("reports missing required columns the rules need", () => {
    const m = mapColumns("skus", ["sku_id", "name"]);
    expect(m.missingRequired).toEqual(["isPerishable", "standardOrderQty"]);
  });
  it("lets a manual override win", () => {
    const m = mapColumns("weekly_sales", ["Wk", "Mat", "Cust", "Qty"], { weekStart: "Wk", skuId: "Mat", distributorId: "Cust" });
    expect(m.missingRequired).toEqual([]);
  });
});
