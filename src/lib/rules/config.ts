import { z } from "zod";

/**
 * Raghav's documented forecasting rules, as data. The engine reads only this object, so every threshold can
 * be changed on the Rules page (each change is a new, versioned row in rules_versions).
 */
export const rulesConfigSchema = z.object({
  // Rule 1 — festival uplift on expected demand, before any stock-cover check
  festivalMonths: z.array(z.number().int().min(1).max(12)),
  festivalUpliftPct: z.number().min(0).max(200),
  // Rule 2 — high demand
  highDemandPct: z.number().min(0).max(500), // last 4 weeks more than X% above the 12-week average
  highDemandOrderMultiplier: z.number().min(0).max(10),
  shortWindowWeeks: z.number().int().min(1).max(26),
  longWindowWeeks: z.number().int().min(2).max(104),
  // Rules 3–5 — stock cover windows, in weeks of (uplifted) average weekly sales
  minCoverWeeks: z.number().min(0).max(52),
  maxCoverWeeks: z.number().min(0).max(104),
  perishableMinCoverWeeks: z.number().min(0).max(52),
  perishableMaxCoverWeeks: z.number().min(0).max(104),
  // Rule 6 — exceptions go to Raghav's judgement queue
  newSkuMinWeeks: z.number().int().min(0).max(104),
  wowSwingPct: z.number().min(0).max(1000),
  distributorSharePct: z.number().min(0).max(100),
  // Ignore distributor concentration when the total week-on-week change is tiny (noise).
  distributorMinChangePct: z.number().min(0).max(100),
  // SKU ids Raghav marks perishable / not perishable on top of the SKU file's flag
  perishableOverrides: z.record(z.string(), z.boolean()),
}).refine((c) => c.minCoverWeeks < c.maxCoverWeeks, { message: "Minimum cover must be below maximum cover" })
  .refine((c) => c.perishableMinCoverWeeks < c.perishableMaxCoverWeeks, { message: "Perishable minimum must be below maximum" })
  .refine((c) => c.shortWindowWeeks < c.longWindowWeeks, { message: "Short window must be shorter than the long window" });

export type RulesConfig = z.infer<typeof rulesConfigSchema>;

export const DEFAULT_RULES: RulesConfig = {
  festivalMonths: [3, 10, 11],
  festivalUpliftPct: 25,
  highDemandPct: 20,
  highDemandOrderMultiplier: 1.5,
  shortWindowWeeks: 4,
  longWindowWeeks: 12,
  minCoverWeeks: 6,
  maxCoverWeeks: 14,
  perishableMinCoverWeeks: 3,
  perishableMaxCoverWeeks: 4,
  newSkuMinWeeks: 12,
  wowSwingPct: 40,
  distributorSharePct: 40,
  distributorMinChangePct: 10,
  perishableOverrides: {},
};

/** Older stored versions may miss newer keys; fill them from the defaults. */
export const withDefaults = (stored: Partial<RulesConfig> | null | undefined): RulesConfig => ({ ...DEFAULT_RULES, ...(stored ?? {}) });
