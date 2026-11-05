import { describe, it, expect } from "vitest";
import { describeDecision, direction, feedbackContext, findPatterns, type PastDecision } from "@/lib/feedback";

let id = 0;
const d = (skuId: string, runId: number, decision: string, rec: number | null, fin: number | null, reason: string | null = null, at = runId): PastDecision => ({
  skuId, runId, runItemId: runId * 100 + skuId.length, decision, recommendedQty: rec, finalQty: fin, reason, decidedBy: "Raghav", createdAt: new Date(2026, 10, at, 0, 0, ++id),
});

describe("feedback: reading a decision", () => {
  it("knows which way Raghav moved the quantity", () => {
    expect(direction(d("A", 1, "approved", 750, 750))).toBe("kept");
    expect(direction(d("A", 1, "edited", 750, 500))).toBe("down");
    expect(direction(d("A", 1, "edited", 300, 450))).toBe("up");
    expect(direction(d("A", 1, "rejected", 300, 0))).toBe("rejected");
    expect(direction(d("A", 1, "approved", null, 120))).toBe("kept"); // exception: no rule quantity to compare
  });

  it("describes it in one line, without the bulk-approve boilerplate", () => {
    expect(describeDecision(d("A", 1, "edited", 750, 500, "promo ending"))).toBe("Cut 750 → 500 — “promo ending”");
    expect(describeDecision(d("A", 1, "approved", 300, 300, "Bulk approved (stockout risk)"))).toBe("Approved 300");
    expect(describeDecision(d("A", 1, "rejected", 300, 0, "new listing"))).toBe("Rejected the recommendation — “new listing”");
    expect(feedbackContext(d("A", 6, "edited", 750, 500, "promo ending"))).toBe("Planner's last decision on this SKU (run #6): Cut 750 → 500 — “promo ending”.");
  });
});

describe("feedback: repeated overrides", () => {
  it("spots a SKU cut in 3 of the last 4 runs", () => {
    const p = findPatterns([
      d("SKU001", 1, "edited", 750, 500, "promo"), d("SKU001", 2, "edited", 750, 500), d("SKU001", 3, "approved", 750, 750), d("SKU001", 4, "edited", 750, 450, "still slow"),
    ]);
    expect(p).toEqual([{ skuId: "SKU001", direction: "down", count: 3, decided: 4, runs: [1, 2, 4], lastReason: "still slow" }]);
  });

  it("ignores a one-off override and mixed directions", () => {
    expect(findPatterns([d("A", 1, "edited", 100, 50), d("A", 2, "approved", 100, 100), d("A", 3, "approved", 100, 100)])).toEqual([]);
    expect(findPatterns([d("B", 1, "edited", 100, 50), d("B", 2, "edited", 100, 150), d("B", 3, "approved", 100, 100), d("B", 4, "approved", 100, 100)])).toEqual([]);
  });

  it("counts a line decided twice only once (its latest decision)", () => {
    const first = d("C", 1, "edited", 100, 50, null, 1);
    const changed = { ...first, decision: "approved", finalQty: 100, createdAt: new Date(2026, 10, 2) };
    expect(findPatterns([first, changed, d("C", 2, "edited", 100, 60)])).toEqual([]);
  });

  it("flags repeated rejections", () => {
    expect(findPatterns([d("D", 1, "rejected", 100, 0, "wrong window"), d("D", 2, "rejected", 100, 0, "wrong window")])[0])
      .toMatchObject({ skuId: "D", direction: "rejected", count: 2, decided: 2 });
  });
});
