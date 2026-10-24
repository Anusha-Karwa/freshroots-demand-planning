import { describe, it, expect } from "vitest";
import { replaySku } from "@/lib/backtest";
import { DEFAULT_RULES } from "@/lib/rules/config";
import { addDays } from "@/lib/dates";

const weeks = (n: number) => Array.from({ length: n }, (_, i) => addDays("2026-06-29", 7 * i));
const input = (weekly: number[]) => ({ skuId: "S", perishable: false, standardOrderQty: 100, weekly, stock: 500 });

describe("backtest replay", () => {
  it("only replays weeks with 12 weeks of history before them", () => {
    const pts = replaySku(input(Array(16).fill(100)), weeks(16), DEFAULT_RULES);
    expect(pts.map((p) => p.asOfWeek)).toEqual(weeks(16).slice(12));
    expect(pts.every((p) => !p.flagged && !p.demandStayedHigh)).toBe(true);
  });
  it("confirms a high-demand flag when demand stays high", () => {
    const w = [...Array(8).fill(100), ...Array(4).fill(140), ...Array(4).fill(145)]; // +24% vs the 12-week average
    const p = replaySku(input(w), weeks(16), DEFAULT_RULES)[0];
    expect(p.flagged).toBe(true);
    expect(p.demandStayedHigh).toBe(true);
  });
  it("compares fresh and month-old forecasts against the actual week", () => {
    const w = [...Array(12).fill(100), 200, 200, 200, 200];
    const pts = replaySku(input(w), weeks(16), DEFAULT_RULES);
    const last = pts[pts.length - 1];
    expect(last.actual).toBe(200);
    expect(last.freshForecast).toBeGreaterThan(last.monthlyForecast);
  });
});
