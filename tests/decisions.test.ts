import { describe, expect, it } from "vitest";
import { diffConfig, parseDecision, parseExceptionDecision } from "@/lib/decisions";
import { DEFAULT_RULES } from "@/lib/config/rules";

describe("parseDecision", () => {
  it("approve needs nothing else", () => expect(parseDecision("approve", "", "")).toEqual({ kind: "approve" }));
  it("edit needs a whole qty ≥ 0 and a reason", () => {
    expect(parseDecision("edit", "450", "distributor order cancelled")).toEqual({ kind: "edit", qty: 450, reason: "distributor order cancelled" });
    expect(() => parseDecision("edit", "450", "")).toThrow(/reason/);
    expect(() => parseDecision("edit", "4.5", "why")).toThrow(/whole/);
    expect(() => parseDecision("edit", "-1", "why")).toThrow(/whole/);
  });
  it("reject needs a reason", () => {
    expect(() => parseDecision("reject", "", "  ")).toThrow(/reason/);
    expect(parseDecision("reject", "", "scheme ending")).toEqual({ kind: "reject", reason: "scheme ending" });
  });
});

describe("parseExceptionDecision", () => {
  it("always needs a note; orders need qty > 0", () => {
    expect(() => parseExceptionDecision("no_action", "", "")).toThrow(/note/);
    expect(() => parseExceptionDecision("order", "0", "launch push")).toThrow(/> 0/);
    expect(parseExceptionDecision("order", "200", "launch push")).toEqual({ kind: "order", qty: 200, note: "launch push" });
  });
});

describe("diffConfig", () => {
  it("lists only what changed", () => {
    const b = { ...DEFAULT_RULES, highDemand: { ...DEFAULT_RULES.highDemand, thresholdPct: 25 }, perishableOverrides: { SKU002: true } };
    expect(diffConfig(DEFAULT_RULES, b)).toEqual(["highDemand.thresholdPct: 20 → 25", "perishableOverrides.SKU002: — → true"]);
    expect(diffConfig(DEFAULT_RULES, DEFAULT_RULES)).toEqual([]);
  });
});
