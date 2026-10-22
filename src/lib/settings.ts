import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { DEFAULT_RULES, rulesConfigSchema, type RulesConfig } from "@/lib/config/rules";
import { DEFAULT_BASELINE, baselineSchema, type Baseline } from "@/lib/config/baseline";

/** Creates rules v1 and the baseline settings if they don't exist yet. Safe to call repeatedly. */
export async function ensureDefaults() {
  const db = await getDb();
  const [rules] = await db.select().from(schema.rulesConfigVersions).limit(1);
  if (!rules) {
    await db.insert(schema.rulesConfigVersions).values({
      config: DEFAULT_RULES,
      changedBy: "system",
      note: "Raghav's documented rules (initial)",
    });
  }
  await db
    .insert(schema.appSettings)
    .values({ key: "baseline", value: DEFAULT_BASELINE, updatedBy: "system" })
    .onConflictDoNothing();
}

export async function getActiveRules(): Promise<{ version: number; config: RulesConfig }> {
  await ensureDefaults();
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.rulesConfigVersions)
    .orderBy(desc(schema.rulesConfigVersions.version))
    .limit(1);
  return { version: row.version, config: rulesConfigSchema.parse(row.config) };
}

export async function getBaseline(): Promise<Baseline> {
  await ensureDefaults();
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "baseline"));
  return baselineSchema.parse(row.value);
}
