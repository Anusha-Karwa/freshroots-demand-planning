import { z } from "zod";

/** Pre-build decision #2: the baseline the outcome is measured against. Stored in app_settings. */
export const baselineSchema = z.object({
  // ₹ per quarter
  stockoutLossPerQuarter: z.object({ low: z.number(), high: z.number() }),
  overstockWriteoffPerQuarter: z.object({ low: z.number(), high: z.number() }),
  dataAgeWeeks: z.object({ low: z.number(), high: z.number() }),
  planningCycle: z.string(),
  plannerDaysPerMonth: z.number(),
  targetDataAgeDays: z.number(),
  buildCost: z.number(), // ₹, for payback
  killSwitch: z.object({
    overrideRatePct: z.number(), // early kill: rejects + edits > X% ...
    overrideLookbackRuns: z.number().int(), // ... over the last N runs
    monthlyLossLimit: z.number(), // outcome kill: ₹/month above this ...
    consecutiveMonths: z.number().int(), // ... for N consecutive months
  }),
});

export type Baseline = z.infer<typeof baselineSchema>;

const LAKH = 100_000;

export const DEFAULT_BASELINE: Baseline = {
  stockoutLossPerQuarter: { low: 18 * LAKH, high: 22 * LAKH },
  overstockWriteoffPerQuarter: { low: 10 * LAKH, high: 12 * LAKH },
  dataAgeWeeks: { low: 3, high: 4 },
  planningCycle: "monthly",
  plannerDaysPerMonth: 2,
  targetDataAgeDays: 4,
  buildCost: 15 * LAKH,
  killSwitch: {
    overrideRatePct: 50,
    overrideLookbackRuns: 4,
    monthlyLossLimit: 11 * LAKH,
    consecutiveMonths: 2,
  },
};

/** Monthly loss band derived from the quarterly baseline: ₹28–34 L/quarter ≈ ₹9.3–11.3 L/month. */
export function monthlyLossBand(b: Baseline) {
  const low = (b.stockoutLossPerQuarter.low + b.overstockWriteoffPerQuarter.low) / 3;
  const high = (b.stockoutLossPerQuarter.high + b.overstockWriteoffPerQuarter.high) / 3;
  return { low, high, mid: (low + high) / 2 };
}
