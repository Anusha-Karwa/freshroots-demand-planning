import { describe, expect, it } from "vitest";
import { DEFAULT_RULES as R } from "@/lib/config/rules";
import { runBacktest } from "@/lib/rules/backtest";
import type { SalesHistory, SkuInfo } from "@/lib/rules/data";
import { addDays } from "@/lib/seed/parse";

const START = "2025-12-01"; // a Monday; cutoffs plan for late Feb and March (a festival month)
const weeksOf = (n: number) => Array.from({ length: n }, (_, i) => addDays(START, i * 7));

const sku = (skuId: string, over: Partial<SkuInfo> = {}): SkuInfo => ({
  skuId, name: skuId, category: null, isPerishable: false, standardOrderQty: 100,
  unitCost: 10, unitPrice: 15, priceSource: "placeholder", vendorId: null, ...over,
});

const hist = (series: Record<string, number[]>): SalesHistory => {
  const n = Math.max(...Object.values(series).map((s) => s.length));
  return { weeks: weeksOf(n), bySku: new Map(Object.entries(series)), hasDistributorDetail: false };
};

const noFestival = { ...R, festival: { ...R.festival, months: [] } };

describe("backtest", () => {
  it("uses every cutoff with a full 12-week baseline and at least one outcome week", () => {
    const r = runBacktest(hist({ A: Array(16).fill(100) }), [sku("A")], noFestival);
    expect(r.cutoffs).toEqual(weeksOf(16).slice(11, 15)); // weeks 12..15
    expect(r.rows.map((x) => x.outcomeWeeks)).toEqual([4, 3, 2, 1]);
  });

  it("counts a high-demand flag that held up as a true positive", () => {
    // gradual ramp that keeps rising: flagged at the last cutoffs, and the next weeks stay high
    const ramp = [...Array(10).fill(100), 110, 120, 140, 160, 180, 200];
    const r = runBacktest(hist({ A: ramp }), [sku("A")], noFestival);
    const flagged = r.rows.filter((x) => x.predictedHigh);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged.every((x) => x.actualHigh)).toBe(true);
    expect(r.highDemand.fp).toBe(0);
  });

  it("counts a one-off spike as a false positive", () => {
    // 4 high weeks (+29% vs the 12-week average) then back to normal: the flag doesn't hold up
    const spike = [...Array(8).fill(100), 150, 150, 150, 150, 100, 100, 100, 100];
    const r = runBacktest(hist({ A: spike }), [sku("A")], noFestival);
    const first = r.rows[0];
    expect(first).toMatchObject({ predictedHigh: true, actualHigh: false });
    expect(r.highDemand.fp).toBeGreaterThanOrEqual(1);
  });

  it("leaves exceptions out of the agreement score", () => {
    const swing = [...Array(11).fill(100), 200, 200, 200, 200, 200]; // +100% WoW at the first cutoff
    const r = runBacktest(hist({ A: swing }), [sku("A")], noFestival);
    expect(r.rows[0].exception).toBe(true);
    expect(r.highDemand.n).toBe(r.rows.filter((x) => !x.exception).length);
  });

  it("skips SKUs with less than 12 weeks of history at a cutoff", () => {
    const late = [...Array(6).fill(null), ...Array(10).fill(50)] as (number | null)[];
    const h: SalesHistory = { weeks: weeksOf(16), bySku: new Map([["N", late]]), hasDistributorDetail: false };
    expect(runBacktest(h, [sku("N")], noFestival).rows).toEqual([]);
  });

  it("shows fresh data beating stale data on a demand shift, in units and ₹", () => {
    // demand steps up from 100 to 150 at week 9; the stale forecast still averages the old level
    const step = [...Array(8).fill(100), ...Array(8).fill(150)];
    const r = runBacktest(hist({ A: step }), [sku("A")], noFestival);
    expect(r.forecast.n).toBe(4);
    expect(r.forecast.freshWapePct!).toBeLessThan(r.forecast.staleWapePct!);
    expect(r.forecast.stale.lostSales).toBeGreaterThan(r.forecast.fresh.lostSales);
    expect(r.forecast.savings).toBeGreaterThan(0);
    expect(r.forecast.placeholderPrices).toBe(true);
  });

  it("values under-forecast at price and over-forecast at cost", () => {
    // flat 100 → forecast 100; outcome 120 for one week at the last cutoff → 20 units short × ₹15
    const s = [...Array(15).fill(100), 120];
    const r = runBacktest(hist({ A: s }), [sku("A")], noFestival);
    const last = r.rows.at(-1)!;
    expect(last.fresh).toEqual({ under: 20, over: 0, lostSales: 300, excess: 0 });
  });

  it("applies the festival uplift to the forecast for the planned month", () => {
    const r = runBacktest(hist({ A: Array(16).fill(100) }), [sku("A")], R);
    for (const row of r.rows) expect(row.freshForecast).toBe(row.planningMonth === 3 ? 125 : 100);
    expect(r.rows.map((x) => x.planningMonth)).toEqual([2, 3, 3, 3]);
  });

  it("replays stock flags only where a snapshot exists the Monday after the cutoff", () => {
    const h = hist({ A: Array(16).fill(100) });
    const cutoff = h.weeks[12];
    const snaps = new Map([[addDays(cutoff, 8), new Map([["A", 300]])]]); // Tuesday after: within ±3 days
    const r = runBacktest(h, [sku("A")], noFestival, snaps);
    expect(r.stockFlags.available).toBe(true);
    expect(r.stockFlags.cutoffsWithStock).toEqual([cutoff]);
    // 300 units = 3 weeks of cover, demand stayed at 100 → stockout flag was right
    expect(r.stockFlags.stockout).toMatchObject({ tp: 1, n: 1, agreementPct: 100 });
  });

  it("reports stock flags as unavailable without stock history", () => {
    const r = runBacktest(hist({ A: Array(16).fill(100) }), [sku("A")], noFestival);
    expect(r.stockFlags.available).toBe(false);
    expect(r.raghav).toEqual({ available: false, targetPct: 85 });
  });
});
