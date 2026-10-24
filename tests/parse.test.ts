import { describe, it, expect } from "vitest";
import { parseBool, parseDate, parseNumber, parseWeek, parseYearMonth, readCsv } from "@/lib/data/parse";
import { autoMap, missingRequired } from "@/lib/data/columns";
import { isoWeekLabel, isoWeekToMonday, yearMonthOfWeek } from "@/lib/dates";

describe("numbers", () => {
  it("reads Indian formats, currency and SAP negatives", () => {
    expect(parseNumber("₹1,23,456.50")).toBe(123456.5);
    expect(parseNumber("Rs. 500")).toBe(500);
    expect(parseNumber("(120)")).toBe(-120);
    expect(parseNumber("120-")).toBe(-120);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("abc")).toBeNaN();
  });
});

describe("dates and weeks", () => {
  it("reads ISO weeks as their Monday", () => {
    expect(isoWeekToMonday("2026-W27")).toBe("2026-06-29");
    expect(isoWeekToMonday("2026-W42")).toBe("2026-10-12");
    expect(isoWeekToMonday("2026-W01")).toBe("2025-12-29");
    expect(isoWeekLabel("2026-10-12")).toBe("2026-W42");
  });
  it("reads Indian day-first dates and rejects impossible ones", () => {
    expect(parseDate("19.10.2026")).toBe("2026-10-19");
    expect(parseDate("19/10/2026")).toBe("2026-10-19");
    expect(parseDate("20261019")).toBe("2026-10-19");
    expect(parseDate("31-02-2026")).toBeNull();
  });
  it("snaps any date to its week's Monday", () => {
    expect(parseWeek("2026-10-22")).toBe("2026-10-19");
  });
  it("puts a week in the month of its Thursday", () => {
    expect(yearMonthOfWeek("2026-09-28")).toBe("2026-10"); // Mon 28 Sep → Thu 1 Oct
  });
  it("reads year-months", () => {
    expect(parseYearMonth("2026-3")).toBe("2026-03");
    expect(parseYearMonth("Oct-2026")).toBe("2026-10");
    expect(parseYearMonth("2026-13")).toBeNull();
  });
});

describe("booleans", () => {
  it("understands perishability words", () => {
    expect(parseBool("High")).toBe(true);
    expect(parseBool("Low")).toBe(false);
    expect(parseBool("Y")).toBe(true);
    expect(parseBool("maybe")).toBeNull();
  });
});

describe("csv + column matching", () => {
  it("strips BOM, trims, and maps SAP-style headers", () => {
    const { headers, rows } = readCsv("﻿Material, Posting Week ,Sold-to,Billed Qty\nSKU1,2026-W27,D1, 5 \n\n");
    expect(headers).toEqual(["Material", "Posting Week", "Sold-to", "Billed Qty"]);
    expect(rows[0]["Billed Qty"]).toBe("5");
    const map = autoMap("sales", headers);
    expect(map).toEqual({ week: "Posting Week", sku: "Material", distributor: "Sold-to", units: "Billed Qty" });
    expect(missingRequired("sales", map)).toEqual([]);
  });
  it("matches the supplied seed headers", () => {
    const map = autoMap("skus", ["SKU_ID", "SKU_Name", "Category", "Perishability", "Standard_Reorder_Qty", "Unit_of_Measure", "Distributor_ID"]);
    expect(map.perishable).toBe("Perishability");
    expect(map.standardOrderQty).toBe("Standard_Reorder_Qty");
    expect(map.supplier).toBe("Distributor_ID");
  });
  it("reports missing required columns", () => {
    expect(missingRequired("skus", autoMap("skus", ["SKU_ID", "SKU_Name"]))).toContain("Standard order quantity");
  });
});
