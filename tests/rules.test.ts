import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R, type RulesConfig } from "@/lib/config/rules";
import { distributorConcentration, evaluateSku, ruleFlags, type SkuInput } from "@/lib/rules/engine";

const JUNE = 6; // not a festival month
const OCT = 10; // festival month

/** 12 flat weeks at `base`, then 4 weeks at `recent` (16 weeks of history). */
const history = (base: number, recent = base) => [...Array(12).fill(base), ...Array(4).fill(recent)];

const sku = (over: Partial<SkuInput> = {}): SkuInput => ({
  skuId: "T1",
  isPerishable: false,
  standardOrderQty: 100,
  weeklyUnits: history(100),
  stockOnHand: 1000, // 10 weeks of 100/week: inside the 6–14 window
  ...over,
});

const flagsOf = (s: SkuInput, month = JUNE, cfg: RulesConfig = R) => ruleFlags(s, cfg, month);

describe("rule 1 — festival uplift", () => {
  it("multiplies expected demand by 1.25 in Oct, Nov and Mar only", () => {
    for (const m of [10, 11, 3]) expect(evaluateSku(sku(), R, m).metrics.expectedWeekly).toBe(125);
    for (const m of [1, 2, 4, 5, 6, 7, 8, 9, 12]) expect(evaluateSku(sku(), R, m).metrics.expectedWeekly).toBe(100);
  });

  it("applies before the threshold checks: 7 weeks of cover becomes 5.6 → STOCKOUT_RISK", () => {
    const s = sku({ stockOnHand: 700 });
    expect(flagsOf(s, JUNE)).toEqual([]);
    expect(flagsOf(s, OCT)).toEqual(["STOCKOUT_RISK"]);
    expect(evaluateSku(s, R, OCT).metrics.weeksOfCover).toBe(5.6);
  });

  it("can clear an overstock flag: 15 weeks of cover becomes 12", () => {
    const s = sku({ stockOnHand: 1500 });
    expect(flagsOf(s, JUNE)).toEqual(["OVERSTOCK_RISK"]);
    expect(flagsOf(s, OCT)).toEqual([]);
  });

  it("uses the configured months and multiplier", () => {
    const cfg = { ...R, festival: { months: [6], upliftMultiplier: 1.5 } };
    expect(evaluateSku(sku(), cfg, JUNE).metrics.expectedWeekly).toBe(150);
  });
});

describe("rule 2 — high demand", () => {
  it("flags when last 4 weeks are more than 20% above the 12-week average and recommends 1.5× standard qty", () => {
    // 12-week window = 8 weeks at 100 + 4 at 130 → avg12 = 110; avg4 = 130 → +18.2%: not enough
    expect(flagsOf(sku({ weeklyUnits: history(100, 130) }))).not.toContain("HIGH_DEMAND");
    // 8×100 + 4×140 → avg12 113.33; avg4 140 → +23.5%
    const e = evaluateSku(sku({ weeklyUnits: history(100, 140), stockOnHand: 1200 }), R, JUNE);
    expect(e).toMatchObject({ kind: "flag", flags: ["HIGH_DEMAND"], action: "REORDER", recommendedQty: 150 });
  });

  it("does not flag at exactly 20%", () => {
    // 8 weeks at 75 + 4 at 100: avg12 = 1000/12 = 83.33…, avg4 = 100 → exactly +20% (a floating-point edge)
    const exact = [...Array(4).fill(75), ...Array(8).fill(75), ...Array(4).fill(100)];
    expect(flagsOf(sku({ weeklyUnits: exact, stockOnHand: 1000 }))).not.toContain("HIGH_DEMAND");
    const above = [...Array(12).fill(75), ...Array(4).fill(101)];
    expect(flagsOf(sku({ weeklyUnits: above, stockOnHand: 1000 }))).toContain("HIGH_DEMAND");
  });

  it("does not flag when sales are all zero", () => {
    expect(flagsOf(sku({ weeklyUnits: history(0), stockOnHand: 0 }))).toEqual([]);
  });
});

describe("rule 3 — stockout risk", () => {
  it("flags when stock covers fewer than 6 weeks and recommends an immediate reorder of the standard qty", () => {
    const e = evaluateSku(sku({ stockOnHand: 599 }), R, JUNE);
    expect(e).toMatchObject({ kind: "flag", flags: ["STOCKOUT_RISK"], action: "REORDER_NOW", recommendedQty: 100 });
  });

  it("does not flag at exactly 6 weeks", () => {
    expect(flagsOf(sku({ stockOnHand: 600 }))).toEqual([]);
  });

  it("flags zero stock", () => {
    expect(flagsOf(sku({ stockOnHand: 0 }))).toEqual(["STOCKOUT_RISK"]);
  });

  it("with high demand too, reorders now at 1.5×", () => {
    const e = evaluateSku(sku({ weeklyUnits: history(100, 140), stockOnHand: 300 }), R, JUNE);
    expect(e).toMatchObject({ flags: ["HIGH_DEMAND", "STOCKOUT_RISK"], primaryFlag: "STOCKOUT_RISK", action: "REORDER_NOW", recommendedQty: 150 });
  });
});

describe("rule 4 — overstock risk", () => {
  it("flags when stock exceeds 14 weeks and recommends pausing the next order", () => {
    const e = evaluateSku(sku({ stockOnHand: 1401 }), R, JUNE);
    expect(e).toMatchObject({ kind: "flag", flags: ["OVERSTOCK_RISK"], action: "PAUSE_NEXT_ORDER", recommendedQty: 0 });
  });

  it("does not flag at exactly 14 weeks", () => {
    expect(flagsOf(sku({ stockOnHand: 1400 }))).toEqual([]);
  });

  it("flags stock with zero sales (dead stock)", () => {
    expect(flagsOf(sku({ weeklyUnits: history(0), stockOnHand: 50 }))).toEqual(["OVERSTOCK_RISK"]);
    expect(evaluateSku(sku({ weeklyUnits: history(0), stockOnHand: 50 }), R, JUNE).metrics.weeksOfCover).toBeNull();
  });
});

describe("rule 5 — perishable windows (min 3, max 4 weeks)", () => {
  const p = (stock: number) => sku({ isPerishable: true, stockOnHand: stock });
  it("uses 3/4 weeks instead of 6/14", () => {
    expect(flagsOf(p(299))).toEqual(["STOCKOUT_RISK"]);
    expect(flagsOf(p(300))).toEqual([]); // exactly 3 weeks
    expect(flagsOf(p(400))).toEqual([]); // exactly 4 weeks
    expect(flagsOf(p(401))).toEqual(["OVERSTOCK_RISK"]);
    expect(flagsOf(p(500))).toEqual(["OVERSTOCK_RISK"]); // 5 weeks: fine for a standard SKU, too much here
    expect(flagsOf(sku({ stockOnHand: 500 }))).toEqual(["STOCKOUT_RISK"]); // and a standard SKU is short at 5
  });

  it("festival month + perishable together: uplift first, then the 3/4 window", () => {
    // expected = 125/week in October → window 375–500 units
    expect(flagsOf(p(374), OCT)).toEqual(["STOCKOUT_RISK"]);
    expect(flagsOf(p(375), OCT)).toEqual([]);
    expect(flagsOf(p(450), OCT)).toEqual([]); // 3.6 weeks
    expect(flagsOf(p(450), JUNE)).toEqual(["OVERSTOCK_RISK"]); // 4.5 weeks without the uplift
    expect(flagsOf(p(500), OCT)).toEqual([]); // exactly 4 weeks of uplifted demand
    // floating-point edge: 112 × 1.25 = 140/week, exactly 3 weeks = 420
    expect(flagsOf(sku({ isPerishable: true, weeklyUnits: history(112), stockOnHand: 420 }), OCT)).toEqual([]);
    expect(flagsOf(p(501), OCT)).toEqual(["OVERSTOCK_RISK"]);
    const e = evaluateSku(p(450), R, OCT);
    expect(e.metrics).toMatchObject({ festival: true, uplift: 1.25, expectedWeekly: 125, weeksOfCover: 3.6, coverWindow: { minWeeks: 3, maxWeeks: 4, perishable: true } });
  });
});

describe("rule 6 — exceptions go to the judgement queue, not auto-recommended", () => {
  it("new SKU with fewer than 12 weeks of history", () => {
    const e = evaluateSku(sku({ weeklyUnits: Array(11).fill(100), stockOnHand: 0 }), R, JUNE);
    expect(e).toMatchObject({ kind: "exception", types: ["NEW_SKU"], ruleFlags: ["STOCKOUT_RISK"] });
    expect("recommendedQty" in e).toBe(false);
    expect(evaluateSku(sku({ weeklyUnits: Array(12).fill(100) }), R, JUNE).kind).toBe("ok"); // exactly 12
  });

  it("week-on-week swing above 40%, either direction", () => {
    const up = [...Array(15).fill(100), 141];
    const down = [...Array(15).fill(100), 59];
    const edge = [...Array(15).fill(100), 140];
    const edgeFloat = [...Array(15).fill(35), 49]; // exactly +40%, computed as 0.3999999999999999 — still no flag
    expect(evaluateSku(sku({ weeklyUnits: up }), R, JUNE)).toMatchObject({ kind: "exception", types: ["WOW_SWING"] });
    expect(evaluateSku(sku({ weeklyUnits: down }), R, JUNE)).toMatchObject({ kind: "exception", types: ["WOW_SWING"] });
    expect(evaluateSku(sku({ weeklyUnits: edge }), R, JUNE).kind).toBe("ok"); // exactly 40%
    expect(evaluateSku(sku({ weeklyUnits: edgeFloat, stockOnHand: 350 }), R, JUNE).kind).toBe("ok");
  });

  it("zero → positive sales counts as a swing; zero → zero does not", () => {
    expect(evaluateSku(sku({ weeklyUnits: [...Array(15).fill(0), 5], stockOnHand: 0 }), R, JUNE)).toMatchObject({ types: ["WOW_SWING"] });
    expect(evaluateSku(sku({ weeklyUnits: history(0), stockOnHand: 0 }), R, JUNE).kind).toBe("ok");
  });

  it("single distributor driving more than 40% of the week-on-week change", () => {
    const e = evaluateSku(
      sku({ distributorLastTwoWeeks: { previous: { A: 50, B: 30, C: 20 }, current: { A: 60, B: 31, C: 21 } } }),
      R,
      JUNE,
    );
    // change +12: A +10 (83%), B +1, C +1
    expect(e).toMatchObject({ kind: "exception", types: ["DISTRIBUTOR_CONCENTRATION"], metrics: { topDistributor: { id: "A", sharePct: 83.33 } } });
    const spread = { previous: { A: 25, B: 25, C: 25, D: 25 }, current: { A: 26, B: 26, C: 26, D: 26 } };
    expect(evaluateSku(sku({ distributorLastTwoWeeks: spread }), R, JUNE).kind).toBe("ok"); // 25% each
  });

  it("is skipped when sales have no distributor detail", () => {
    const e = evaluateSku(sku(), R, JUNE);
    expect(e.metrics.topDistributor).toBeUndefined();
  });

  it("rising demand with overstock is a conflict for Raghav", () => {
    const e = evaluateSku(sku({ weeklyUnits: history(100, 140), stockOnHand: 5000 }), R, JUNE);
    expect(e).toMatchObject({ kind: "exception", types: ["CONFLICTING_FLAGS"], ruleFlags: ["HIGH_DEMAND", "OVERSTOCK_RISK"] });
  });
});

describe("distributorConcentration", () => {
  it("returns null when the total did not change", () => {
    expect(distributorConcentration({ A: 10 }, { A: 10 })).toBeNull();
  });
  it("counts the distributor moving with the total, not against it", () => {
    // total −10: A −20 (200% of the drop), B +10
    expect(distributorConcentration({ A: 50, B: 50 }, { A: 30, B: 60 })).toEqual({ id: "A", sharePct: 200 });
  });
});

describe("no flag", () => {
  it("steady demand with 10 weeks of cover", () => {
    expect(evaluateSku(sku(), R, JUNE)).toMatchObject({ kind: "ok", metrics: { avg4: 100, avg12: 100, pct4v12: 0, weeksOfCover: 10 } });
  });
});
