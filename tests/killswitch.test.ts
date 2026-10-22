import { describe, expect, it } from "vitest";
import { DEFAULT_BASELINE as B } from "@/lib/config/baseline";
import { earlyKill, killSwitch, outcomeKill, payback } from "@/lib/killswitch";

const L = 100_000;
const run = (runId: number, decided: number, overridden: number) => ({ runId, decided, overridden });

describe("early kill switch (override rate over the last 4 runs)", () => {
  it("is grey with no decisions", () => expect(earlyKill([], B).status).toBe("grey"));
  it("goes red above 50%", () => {
    const r = earlyKill([run(5, 10, 6), run(4, 10, 5)], B);
    expect(r).toMatchObject({ status: "red", ratePct: 55 });
  });
  it("is not red at exactly 50%", () => expect(earlyKill([run(1, 10, 5)], B).status).toBe("amber"));
  it("is amber above 35%, green at or below", () => {
    expect(earlyKill([run(1, 100, 36)], B).status).toBe("amber");
    expect(earlyKill([run(1, 100, 35)], B).status).toBe("green");
  });
  it("only counts the last 4 runs that had decisions", () => {
    // newest first: four clean runs, then an old run full of overrides that must be ignored
    const r = earlyKill([run(9, 0, 0), run(8, 10, 0), run(7, 10, 0), run(6, 10, 0), run(5, 10, 0), run(4, 10, 10)], B);
    expect(r).toMatchObject({ status: "green", runsCounted: 4, decided: 40, overridden: 0 });
  });
});

describe("outcome kill switch (losses above ₹11 L/month for 2 months)", () => {
  it("is grey with no months", () => expect(outcomeKill([], B).status).toBe("grey"));
  it("is amber after one bad month and red after two in a row", () => {
    expect(outcomeKill([{ month: "2026-11", total: 12 * L }], B).status).toBe("amber");
    expect(outcomeKill([{ month: "2026-11", total: 12 * L }, { month: "2026-12", total: 11.5 * L }], B).status).toBe("red");
  });
  it("needs the two bad months to be the latest ones", () => {
    const m = [{ month: "2026-10", total: 12 * L }, { month: "2026-11", total: 12 * L }, { month: "2026-12", total: 8 * L }];
    expect(outcomeKill(m, B).status).toBe("green");
  });
  it("is not over the limit at exactly ₹11 L", () => {
    expect(outcomeKill([{ month: "2026-11", total: 11 * L }, { month: "2026-12", total: 11 * L }], B).status).toBe("green");
  });
  it("sorts months before judging", () => {
    expect(outcomeKill([{ month: "2026-12", total: 12 * L }, { month: "2026-11", total: 12 * L }], B).status).toBe("red");
  });
});

describe("payback", () => {
  it("uses the baseline midpoint (₹10.33 L/month) and up to the last 3 months", () => {
    const p = payback([{ month: "2026-11", total: 7 * L }, { month: "2026-12", total: 8 * L }], B);
    expect(Math.round(p.baselineMonthly)).toBe(1_033_333);
    expect(Math.round(p.monthlySavings!)).toBe(283_333);
    expect(p.paybackMonths).toBe(5.3); // ₹15 L ÷ ₹2.83 L
  });
  it("has no payback while losses are above the baseline", () => {
    expect(payback([{ month: "2026-11", total: 12 * L }], B).paybackMonths).toBeNull();
  });
});

describe("overall", () => {
  it("is the worse of the two", () => {
    const k = killSwitch([run(1, 10, 1)], [{ month: "2026-11", total: 12 * L }], B);
    expect(k.overall).toBe("amber");
  });
});
