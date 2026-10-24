import { describe, it, expect } from "vitest";
import { evaluateSku, type SkuInput } from "@/lib/rules/engine";
import { DEFAULT_RULES, rulesConfigSchema } from "@/lib/rules/config";
import { templateReason } from "@/lib/rules/reason";

const JULY = "2026-07-15"; // not a festival month
const OCT = "2026-10-20"; // festival month

/** 12 weeks: 8 weeks at `base`, then 4 weeks at `recent`. */
const series = (base: number, recent = base, weeks = 12) => [...Array(weeks - 4).fill(base), ...Array(4).fill(recent)];

const sku = (over: Partial<SkuInput> = {}): SkuInput => ({
  skuId: "SKU1",
  perishable: false,
  standardOrderQty: 500,
  weekly: series(100),
  stock: 1000, // 10 weeks of 100/wk: inside the 6–14 window
  ...over,
});

const run = (over: Partial<SkuInput> = {}, date = JULY, cfg = DEFAULT_RULES) => evaluateSku(sku(over), cfg, date);

describe("rule 2 — high demand", () => {
  it("flags when the last 4 weeks are more than 20% above the 12-week average", () => {
    // 8×100 + 4×150 → avg12 = 116.67, avg4 = 150 → +28.6%
    const e = run({ weekly: series(100, 150), stock: 1200 });
    expect(e.flags).toEqual(["HIGH_DEMAND"]);
    expect(e.recommendedQty).toBe(750); // 1.5 × 500
    expect(e.action).toBe("reorder");
    expect(e.queue).toBe("review");
  });

  it("does not flag at exactly 20% above (rule says 'more than')", () => {
    // avg4 = 1.2 × avg12  ⇔  8b + 4r = 10r  ⇔  r = 4b/3. b = 75 → r = 100, avg12 = 83.33
    const e = run({ weekly: series(75, 100), stock: 1000 });
    expect(e.metrics.changePct).toBe(20);
    expect(e.flags).not.toContain("HIGH_DEMAND");
  });

  it("flags just above 20%", () => {
    const e = run({ weekly: series(75, 100.5), stock: 1000 });
    expect(e.flags).toContain("HIGH_DEMAND");
  });

  it("is not raised by the festival uplift alone", () => {
    const e = run({ weekly: series(100), stock: 1000 }, OCT);
    expect(e.flags).not.toContain("HIGH_DEMAND");
  });
});

describe("rule 3 — stockout risk", () => {
  it("flags when stock is below 6 weeks of average weekly sales", () => {
    const e = run({ stock: 599 });
    expect(e.flags).toEqual(["STOCKOUT_RISK"]);
    expect(e.action).toBe("reorder_now");
    expect(e.recommendedQty).toBe(500); // standard quantity
    expect(e.metrics.unitsToMinCover).toBe(1);
  });

  it("does not flag at exactly 6 weeks of cover", () => {
    const e = run({ stock: 600 });
    expect(e.metrics.weeksCover).toBe(6);
    expect(e.flags).toEqual([]);
    expect(e.queue).toBe("none");
  });

  it("flags zero stock with demand", () => {
    expect(run({ stock: 0 }).flags).toEqual(["STOCKOUT_RISK"]);
  });

  it("orders 1.5× and now when high demand and stockout risk coincide", () => {
    const e = run({ weekly: series(100, 150), stock: 300 });
    expect(e.flags).toEqual(["HIGH_DEMAND", "STOCKOUT_RISK"]);
    expect(e.action).toBe("reorder_now");
    expect(e.recommendedQty).toBe(750);
  });
});

describe("rule 4 — overstock risk", () => {
  it("flags when stock exceeds 14 weeks and recommends pausing", () => {
    const e = run({ stock: 1401 });
    expect(e.flags).toEqual(["OVERSTOCK_RISK"]);
    expect(e.action).toBe("pause");
    expect(e.recommendedQty).toBe(0);
  });

  it("does not flag at exactly 14 weeks", () => {
    expect(run({ stock: 1400 }).flags).toEqual([]);
  });
});

describe("rule 1 — festival uplift", () => {
  it("raises expected demand by 25% in October, November and March", () => {
    for (const date of ["2026-03-10", "2026-10-20", "2026-11-05"]) {
      expect(run({}, date).metrics.expectedWeekly).toBe(125);
    }
    expect(run({}, "2026-12-01").metrics.expectedWeekly).toBe(100);
  });

  it("is applied before the threshold checks", () => {
    // 700 units = 7 weeks normally (fine) but 5.6 weeks at 125/wk → stockout risk in October
    expect(run({ stock: 700 }, JULY).flags).toEqual([]);
    const oct = run({ stock: 700 }, OCT);
    expect(oct.flags).toEqual(["STOCKOUT_RISK"]);
    expect(oct.metrics.weeksCover).toBe(5.6);
    // 1500 units = 15 weeks normally (overstock) but 12 weeks in October (fine)
    expect(run({ stock: 1500 }, JULY).flags).toEqual(["OVERSTOCK_RISK"]);
    expect(run({ stock: 1500 }, OCT).flags).toEqual([]);
  });
});

describe("rule 5 — perishable SKUs use 3–4 weeks", () => {
  it("uses the tighter window", () => {
    expect(run({ perishable: true, stock: 299 }).flags).toEqual(["STOCKOUT_RISK"]);
    expect(run({ perishable: true, stock: 300 }).flags).toEqual([]);
    expect(run({ perishable: true, stock: 400 }).flags).toEqual([]);
    expect(run({ perishable: true, stock: 401 }).flags).toEqual(["OVERSTOCK_RISK"]);
    // 1000 units is fine for a normal SKU but overstock for a perishable one
    expect(run({ perishable: true, stock: 1000 }).flags).toEqual(["OVERSTOCK_RISK"]);
  });

  it("combines with the festival uplift (festival month + perishable)", () => {
    // expected 125/wk → window 375–500 units
    expect(run({ perishable: true, stock: 374 }, OCT).flags).toEqual(["STOCKOUT_RISK"]);
    expect(run({ perishable: true, stock: 375 }, OCT).flags).toEqual([]);
    expect(run({ perishable: true, stock: 500 }, OCT).flags).toEqual([]);
    expect(run({ perishable: true, stock: 501 }, OCT).flags).toEqual(["OVERSTOCK_RISK"]);
  });

  it("lets Raghav's perishable list override the SKU file", () => {
    const cfg = { ...DEFAULT_RULES, perishableOverrides: { SKU1: true } };
    expect(run({ stock: 1000 }, JULY, cfg).flags).toEqual(["OVERSTOCK_RISK"]);
  });
});

describe("zero sales", () => {
  it("treats any stock with no demand as overstock", () => {
    const e = run({ weekly: series(0), stock: 50 });
    expect(e.flags).toEqual(["OVERSTOCK_RISK"]);
    expect(e.metrics.weeksCover).toBeNull();
  });

  it("raises nothing with no stock and no sales", () => {
    const e = run({ weekly: series(0), stock: 0 });
    expect(e.flags).toEqual([]);
    expect(e.exceptions).toEqual([]);
  });

  it("does not divide by zero for high demand", () => {
    expect(run({ weekly: series(0), stock: 0 }).metrics.changePct).toBeNull();
  });
});

describe("rule 6 — exceptions go to Raghav's judgement queue", () => {
  it("routes new SKUs with fewer than 12 weeks of history", () => {
    const e = run({ weekly: [100, 100, 100, 100, 100], stock: 100 });
    expect(e.exceptions).toContain("NEW_SKU");
    expect(e.queue).toBe("exception");
    expect(e.recommendedQty).toBeNull();
    expect(e.action).toBe("judgement");
    // the rules' view is still shown for reference
    expect(e.flags).toContain("STOCKOUT_RISK");
    expect(e.metrics.ruleSuggestedQty).toBe(500);
  });

  it("does not route a SKU with exactly 12 weeks", () => {
    expect(run().exceptions).not.toContain("NEW_SKU");
  });

  it("routes week-on-week swings above 40% (up or down), not at exactly 40%", () => {
    const w = (last: number) => [...Array(10).fill(100), 100, last];
    expect(run({ weekly: w(141) }).exceptions).toContain("WOW_SWING");
    expect(run({ weekly: w(59) }).exceptions).toContain("WOW_SWING");
    expect(run({ weekly: w(140) }).exceptions).not.toContain("WOW_SWING");
    expect(run({ weekly: w(60) }).exceptions).not.toContain("WOW_SWING");
  });

  it("treats a jump from zero as a swing", () => {
    expect(run({ weekly: [...Array(11).fill(0), 10], stock: 0 }).exceptions).toContain("WOW_SWING");
  });

  it("routes a single distributor driving more than 40% of the week-on-week change", () => {
    const weekly = [...Array(10).fill(100), 100, 120];
    const e = run({
      weekly,
      prevWeekByDistributor: { D1: 50, D2: 50 },
      lastWeekByDistributor: { D1: 70, D2: 50 },
    });
    expect(e.metrics.topDistributor).toEqual({ id: "D1", sharePct: 100, change: 20 });
    expect(e.exceptions).toContain("DISTRIBUTOR_CONCENTRATION");
  });

  it("does not route when the change is spread out", () => {
    const e = run({
      weekly: [...Array(10).fill(100), 100, 120],
      prevWeekByDistributor: { D1: 25, D2: 25, D3: 25, D4: 25 },
      lastWeekByDistributor: { D1: 30, D2: 30, D3: 30, D4: 30 },
    });
    expect(e.exceptions).not.toContain("DISTRIBUTOR_CONCENTRATION");
  });

  it("ignores concentration in tiny changes (below the minimum change)", () => {
    const e = run({
      weekly: [...Array(10).fill(100), 100, 102],
      prevWeekByDistributor: { D1: 50, D2: 50 },
      lastWeekByDistributor: { D1: 52, D2: 50 },
    });
    expect(e.exceptions).not.toContain("DISTRIBUTOR_CONCENTRATION");
  });

  it("is off when sales have no distributor detail", () => {
    expect(run({ weekly: [...Array(10).fill(100), 100, 120] }).metrics.topDistributor).toBeNull();
  });

  it("routes high demand + overstock (the rules disagree)", () => {
    const e = run({ weekly: series(100, 150), stock: 5000 });
    expect(e.flags).toEqual(["HIGH_DEMAND", "OVERSTOCK_RISK"]);
    expect(e.exceptions).toContain("RULES_CONFLICT");
  });

  it("routes SKUs with no stock figure", () => {
    expect(run({ stock: null }).exceptions).toContain("NO_STOCK_DATA");
  });
});

describe("config", () => {
  it("drives every threshold", () => {
    const cfg = { ...DEFAULT_RULES, minCoverWeeks: 8 };
    expect(run({ stock: 700 }, JULY, cfg).flags).toEqual(["STOCKOUT_RISK"]);
    const cfg2 = { ...DEFAULT_RULES, festivalMonths: [7], festivalUpliftPct: 50 };
    expect(run({}, JULY, cfg2).metrics.expectedWeekly).toBe(150);
  });

  it("rejects an inverted window", () => {
    expect(rulesConfigSchema.safeParse({ ...DEFAULT_RULES, minCoverWeeks: 20 }).success).toBe(false);
    expect(rulesConfigSchema.safeParse(DEFAULT_RULES).success).toBe(true);
  });
});

describe("template reason", () => {
  it("shows the numbers behind the flag in at most two sentences", () => {
    const r = templateReason(run({ weekly: series(100, 150), stock: 300 }, OCT));
    expect(r).toContain("+29%");
    expect(r).toContain("25% festival uplift");
    expect(r.split(". ").length).toBeLessThanOrEqual(2);
  });
});
