import { describe, it, expect } from "vitest";
import { resolveDecision } from "@/lib/decisions";

const review = { queue: "review", recommendedQty: 750 };
const exception = { queue: "exception", recommendedQty: null };

describe("Raghav's final call", () => {
  it("approve keeps the rule quantity", () => {
    expect(resolveDecision(review, { decision: "approved" })).toEqual({ decision: "approved", finalQty: 750, reason: null });
  });
  it("edit and reject need a reason", () => {
    expect(() => resolveDecision(review, { decision: "edited", qty: 500 })).toThrow(/reason/);
    expect(() => resolveDecision(review, { decision: "rejected", reason: " " })).toThrow(/reason/);
    expect(resolveDecision(review, { decision: "edited", qty: 500, reason: "promo ends" })).toEqual({ decision: "edited", finalQty: 500, reason: "promo ends" });
    expect(resolveDecision(review, { decision: "rejected", reason: "supplier shut" }).finalQty).toBe(0);
  });
  it("editing to the recommended quantity counts as approval", () => {
    expect(resolveDecision(review, { decision: "edited", qty: 750, reason: "checked" }).decision).toBe("approved");
  });
  it("rejects negative quantities", () => {
    expect(() => resolveDecision(review, { decision: "edited", qty: -1, reason: "x" })).toThrow(/0 or more/);
  });
  it("exceptions need Raghav's own quantity", () => {
    expect(() => resolveDecision(exception, { decision: "approved" })).toThrow(/Set a quantity/);
    expect(resolveDecision(exception, { decision: "approved", qty: 200 })).toEqual({ decision: "approved", finalQty: 200, reason: null });
  });
});
