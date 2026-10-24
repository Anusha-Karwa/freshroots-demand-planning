import { describe, it, expect } from "vitest";
import { earlyStatus, outcomeStatus, payback, worst } from "@/lib/killswitch";
import { DEFAULT_BASELINE as B } from "@/lib/settings";

const L = 100_000;

describe("early kill switch (override rate over the last 4 runs)", () => {
  it("is red above 50%, amber above 35%, green otherwise, grey with no decisions", () => {
    expect(earlyStatus([], B).status).toBe("grey");
    expect(earlyStatus([{ runId: 1, decided: 10, overridden: 6 }], B).status).toBe("red");
    expect(earlyStatus([{ runId: 1, decided: 10, overridden: 5 }], B).status).toBe("amber"); // exactly 50% is not "> 50%"
    expect(earlyStatus([{ runId: 1, decided: 10, overridden: 3 }], B).status).toBe("green");
  });
  it("only looks at the last 4 runs", () => {
    const runs = [1, 2, 3, 4].map((id) => ({ runId: id, decided: 10, overridden: 1 })).concat([{ runId: 0, decided: 100, overridden: 100 }]);
    const s = earlyStatus(runs, B);
    expect(s.runs).toBe(4);
    expect(s.status).toBe("green");
  });
});

describe("outcome kill switch (₹11 L/month, 2 consecutive months)", () => {
  it("is red only for consecutive months above the limit", () => {
    expect(outcomeStatus([{ yearMonth: "2026-08", total: 12 * L }, { yearMonth: "2026-09", total: 11.5 * L }], B)).toBe("red");
    expect(outcomeStatus([{ yearMonth: "2026-07", total: 12 * L }, { yearMonth: "2026-09", total: 12 * L }], B)).toBe("amber");
    expect(outcomeStatus([{ yearMonth: "2026-08", total: 12 * L }, { yearMonth: "2026-09", total: 9 * L }], B)).toBe("green");
    expect(outcomeStatus([{ yearMonth: "2026-12", total: 12 * L }, { yearMonth: "2027-01", total: 12 * L }], B)).toBe("red");
    expect(outcomeStatus([{ yearMonth: "2026-09", total: 11 * L }], B)).toBe("green"); // exactly the limit is not above it
    expect(outcomeStatus([], B)).toBe("grey");
  });
});

describe("payback", () => {
  it("divides the build cost by monthly savings vs the baseline midpoint", () => {
    // midpoint = (28 + 34) / 2 / 3 = ₹10.33 L/month; loss ₹7.33 L → saving ₹3 L → 5 months
    const p = payback([{ yearMonth: "2026-09", total: (31 / 3 - 3) * L }], B);
    expect(p.savingsPerMonth).toBeCloseTo(3 * L);
    expect(p.months).toBeCloseTo(5);
    expect(payback([{ yearMonth: "2026-09", total: 12 * L }], B).months).toBeNull();
  });
});

it("overall is the worst light", () => {
  expect(worst("green", "amber")).toBe("amber");
  expect(worst("grey", "green")).toBe("green");
  expect(worst("red", "grey")).toBe("red");
});
