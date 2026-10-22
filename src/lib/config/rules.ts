import { z } from "zod";

/**
 * Raghav's forecasting rules, as editable config. Defaults mirror his documented rules;
 * every change made on the Rules page is stored as a new version in rules_config_versions.
 */
export const rulesConfigSchema = z.object({
  festival: z.object({
    months: z.array(z.number().int().min(1).max(12)), // applied before any threshold check
    upliftMultiplier: z.number().min(1),
  }),
  highDemand: z.object({
    recentWeeks: z.number().int().min(1), // "last 4 weeks"
    baselineWeeks: z.number().int().min(1), // "12-week weekly average"
    thresholdPct: z.number().min(0), // strictly greater than → flag
    orderMultiplier: z.number().min(0), // × standard order quantity
  }),
  cover: z.object({
    standard: z.object({ minWeeks: z.number().min(0), maxWeeks: z.number().min(0) }),
    perishable: z.object({ minWeeks: z.number().min(0), maxWeeks: z.number().min(0) }),
  }),
  exceptions: z.object({
    minHistoryWeeks: z.number().int().min(1), // fewer weeks → NEW_SKU
    distributorConcentrationPct: z.number().min(0), // one distributor > X% of the WoW change
    wowSwingPct: z.number().min(0), // |week-on-week change| > X%
  }),
});

export type RulesConfig = z.infer<typeof rulesConfigSchema>;

export const DEFAULT_RULES: RulesConfig = {
  festival: { months: [10, 11, 3], upliftMultiplier: 1.25 },
  highDemand: { recentWeeks: 4, baselineWeeks: 12, thresholdPct: 20, orderMultiplier: 1.5 },
  cover: {
    standard: { minWeeks: 6, maxWeeks: 14 },
    perishable: { minWeeks: 3, maxWeeks: 4 },
  },
  exceptions: { minHistoryWeeks: 12, distributorConcentrationPct: 40, wowSwingPct: 40 },
};
