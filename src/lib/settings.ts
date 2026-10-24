import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { schema, type Db } from "@/db";
import { DEFAULT_RULES, withDefaults, type RulesConfig } from "@/lib/rules/config";

/**
 * Pre-build decision #2 (baseline) and #5 (kill criteria) as editable numbers. All ₹ amounts are rupees.
 * Source: the case brief (stockouts ₹18–22 L/quarter, overstock ₹10–12 L/quarter, data 3–4 weeks old,
 * monthly cycle, Raghav ~2 days/month, ₹15 L budget).
 */
export const baselineSchema = z.object({
  stockoutLossQuarterLow: z.number().min(0),
  stockoutLossQuarterHigh: z.number().min(0),
  overstockQuarterLow: z.number().min(0),
  overstockQuarterHigh: z.number().min(0),
  dataAgeDaysBaseline: z.number().min(0), // 3–4 weeks ≈ 25 days
  dataAgeTargetDays: z.number().min(0), // the outcome: procurement acts on data ≤ 4 days old
  plannerDaysPerMonth: z.number().min(0),
  buildCost: z.number().min(0),
  // Kill switch
  earlyRedPct: z.number().min(0).max(100), // edited + rejected share over the last N runs
  earlyAmberPct: z.number().min(0).max(100),
  earlyRuns: z.number().int().min(1).max(20),
  outcomeMonthlyLimit: z.number().min(0), // ₹ per month: the top of the baseline
  outcomeMonths: z.number().int().min(1).max(12), // consecutive months above the limit → red
  // Daily tracker: actual vs forecast beyond ±X% is flagged
  trackerVariancePct: z.number().min(0).max(500),
});
export type Baseline = z.infer<typeof baselineSchema>;

export const DEFAULT_BASELINE: Baseline = {
  stockoutLossQuarterLow: 1_800_000,
  stockoutLossQuarterHigh: 2_200_000,
  overstockQuarterLow: 1_000_000,
  overstockQuarterHigh: 1_200_000,
  dataAgeDaysBaseline: 25,
  dataAgeTargetDays: 4,
  plannerDaysPerMonth: 2,
  buildCost: 1_500_000,
  earlyRedPct: 50,
  earlyAmberPct: 35,
  earlyRuns: 4,
  outcomeMonthlyLimit: 1_100_000,
  outcomeMonths: 2,
  trackerVariancePct: 25,
};

/** Monthly baseline range and midpoint (quarterly ÷ 3). */
export function baselineMonthly(b: Baseline) {
  const low = (b.stockoutLossQuarterLow + b.overstockQuarterLow) / 3;
  const high = (b.stockoutLossQuarterHigh + b.overstockQuarterHigh) / 3;
  return { low, high, mid: (low + high) / 2 };
}

async function readSetting<T>(db: Db, key: string): Promise<T | null> {
  const [row] = await db.select().from(schema.settings).where(eq(schema.settings.key, key));
  return (row?.value as T) ?? null;
}

export async function writeSetting(db: Db, key: string, value: unknown, by: string) {
  await db.insert(schema.settings).values({ key, value, updatedBy: by })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedBy: by, updatedAt: new Date() } });
}

export async function getBaseline(db: Db): Promise<Baseline> {
  return { ...DEFAULT_BASELINE, ...((await readSetting<Partial<Baseline>>(db, "baseline")) ?? {}) };
}

/** Supplier id → Zoho vendor id. Unmapped suppliers use ZOHO_DEFAULT_VENDOR_ID. */
export async function getVendorMap(db: Db): Promise<Record<string, string>> {
  return (await readSetting<Record<string, string>>(db, "vendor_map")) ?? {};
}

/** The rules version in force (created from the defaults on first use). */
export async function getRules(db: Db): Promise<{ id: number; config: RulesConfig; createdBy: string; createdAt: Date }> {
  const [row] = await db.select().from(schema.rulesVersions).orderBy(desc(schema.rulesVersions.id)).limit(1);
  if (row) return { ...row, config: withDefaults(row.config) };
  const [created] = await db.insert(schema.rulesVersions)
    .values({ config: DEFAULT_RULES, createdBy: "system", note: "Raghav's documented rules (defaults)" }).returning();
  return { ...created, config: DEFAULT_RULES };
}
