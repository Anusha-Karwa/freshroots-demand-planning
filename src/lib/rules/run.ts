import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getActiveRules } from "@/lib/settings";
import { evaluateSku, type Evaluation } from "./engine";
import { loadPlanningInputs } from "./data";
import { templateExceptionNote, templateReason } from "./reason";

export interface RunSummary {
  runId: number;
  dataAsOf: string;
  planningWeek: string;
  planningMonth: number;
  rulesVersion: number;
  counts: { evaluated: number; flagged: number; exceptions: number; byFlag: Record<string, number>; skippedNoStock: number };
  evaluations: Evaluation[];
}

/** Ingested data → rules → decision log. Reasons are template text here; phase 4 swaps in Gemini. */
export async function runForecast(trigger: "cron" | "manual"): Promise<RunSummary> {
  const db = await getDb();
  const rules = await getActiveRules();
  const [run] = await db.insert(schema.forecastRuns).values({ trigger, rulesVersion: rules.version }).returning({ id: schema.forecastRuns.id });
  try {
    const data = await loadPlanningInputs(db);
    if (!data) throw new Error("No sales data loaded — run npm run seed first.");
    const evaluations = data.inputs.map((s) => evaluateSku(s, rules.config, data.planningMonth));

    const flagged = evaluations.filter((e): e is Extract<Evaluation, { kind: "flag" }> => e.kind === "flag");
    const exceptions = evaluations.filter((e): e is Extract<Evaluation, { kind: "exception" }> => e.kind === "exception");
    if (flagged.length)
      await db.insert(schema.recommendations).values(
        flagged.map((e) => ({
          runId: run.id, skuId: e.skuId, flags: e.flags, primaryFlag: e.primaryFlag, metrics: e.metrics,
          action: e.action, recommendedQty: e.recommendedQty,
          reason: templateReason(e, data.planningMonth), reasonSource: "template",
        })),
      );
    if (exceptions.length)
      await db.insert(schema.exceptions).values(
        exceptions.map((e) => ({
          runId: run.id, skuId: e.skuId, types: e.types, metrics: { ...e.metrics, ruleFlags: e.ruleFlags },
          aiNote: templateExceptionNote(e), aiNoteSource: "template",
        })),
      );

    const byFlag: Record<string, number> = {};
    for (const e of flagged) for (const f of e.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;
    const counts = {
      evaluated: evaluations.length, flagged: flagged.length, exceptions: exceptions.length, byFlag,
      skippedNoStock: data.missingStock.length,
    };
    await db
      .update(schema.forecastRuns)
      .set({ status: "done", finishedAt: new Date(), dataAsOf: data.dataAsOf, counts })
      .where(eq(schema.forecastRuns.id, run.id));
    return {
      runId: run.id, dataAsOf: data.dataAsOf, planningWeek: data.planningWeek, planningMonth: data.planningMonth,
      rulesVersion: rules.version, counts, evaluations,
    };
  } catch (err) {
    await db
      .update(schema.forecastRuns)
      .set({ status: "failed", finishedAt: new Date(), error: String(err) })
      .where(eq(schema.forecastRuns.id, run.id));
    throw err;
  }
}
