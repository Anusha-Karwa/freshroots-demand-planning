import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getActiveRules } from "@/lib/settings";
import { mapLimit, noteException, reviewFlag } from "@/lib/adapters/gemini";
import { evaluateSku, type Evaluation } from "./engine";
import { loadPlanningInputs, type SkuInfo } from "./data";
import { FLAG_LABEL, templateExceptionNote, templateReason } from "./reason";
import { MONTHS } from "@/lib/ui/format";

type Flagged = Extract<Evaluation, { kind: "flag" }>;
type Excepted = Extract<Evaluation, { kind: "exception" }>;

export interface RunSummary {
  runId: number;
  dataAsOf: string;
  planningWeek: string;
  planningMonth: number;
  rulesVersion: number;
  counts: {
    evaluated: number;
    flagged: number;
    exceptions: number;
    byFlag: Record<string, number>;
    skippedNoStock: number;
    aiRouted: number;
    reasonSource: "gemini" | "template" | "mixed";
  };
  evaluations: Evaluation[];
}

const facts = (e: Flagged | Excepted, sku: SkuInfo | undefined, planningMonth: number) => ({
  sku: e.skuId,
  name: sku?.name,
  category: sku?.category,
  planningMonth: MONTHS[planningMonth - 1],
  ...(e.kind === "flag"
    ? { flags: e.flags.map((f) => FLAG_LABEL[f]), rulesAction: e.action, rulesQty: e.recommendedQty }
    : { exceptionTypes: e.types, ruleFlags: e.ruleFlags }),
  ...e.metrics,
});

/**
 * Data → rules (no AI) → Gemini reason per flag (may route odd ones to exceptions; never changes a
 * quantity) → decision log.
 */
export async function runForecast(trigger: "cron" | "manual"): Promise<RunSummary> {
  const db = await getDb();
  const rules = await getActiveRules();
  const [run] = await db.insert(schema.forecastRuns).values({ trigger, rulesVersion: rules.version }).returning({ id: schema.forecastRuns.id });
  try {
    const data = await loadPlanningInputs(db, rules.config);
    if (!data) throw new Error("No sales data loaded yet — load it on the Data page (or npm run seed).");
    const skuById = new Map(data.skus.map((s) => [s.skuId, s]));
    const evaluations = data.inputs.map((s) => evaluateSku(s, rules.config, data.planningMonth));

    // Every SKU's forecast, for the tracker.
    if (evaluations.length)
      await db.insert(schema.runForecasts).values(
        evaluations.map((e) => ({
          runId: run.id, skuId: e.skuId, planningWeek: data.planningWeek,
          expectedWeekly: e.metrics.expectedWeekly, stockOnHand: e.metrics.stockOnHand, outcome: e.kind,
        })),
      );

    const flagged = evaluations.filter((e): e is Flagged => e.kind === "flag");
    const exceptions = evaluations.filter((e): e is Excepted => e.kind === "exception");

    const reviews = await mapLimit(flagged, 5, (e) =>
      reviewFlag(facts(e, skuById.get(e.skuId), data.planningMonth), templateReason(e, data.planningMonth)),
    );
    // Gemini may move a flag to Raghav's exceptions queue; it never changes the flag's numbers.
    const kept: Flagged[] = [];
    const routed: Excepted[] = [];
    const routedNotes = new Map<string, string>();
    flagged.forEach((e, i) => {
      const r = reviews[i];
      if (!r.unusual) return void kept.push(e);
      routed.push({ kind: "exception", skuId: e.skuId, types: ["AI_UNUSUAL"], ruleFlags: e.flags, metrics: e.metrics });
      routedNotes.set(e.skuId, `${r.unusualWhy} ${r.reason}`.trim());
    });

    if (kept.length) {
      const reviewOf = new Map(flagged.map((e, i) => [e.skuId, reviews[i]]));
      await db.insert(schema.recommendations).values(
        kept.map((e) => ({
          runId: run.id, skuId: e.skuId, flags: e.flags, primaryFlag: e.primaryFlag, metrics: e.metrics,
          action: e.action, recommendedQty: e.recommendedQty,
          reason: reviewOf.get(e.skuId)!.reason, reasonSource: reviewOf.get(e.skuId)!.source,
        })),
      );
    }

    const allExceptions = [...exceptions, ...routed];
    const notes = await mapLimit(allExceptions, 5, async (e) =>
      routedNotes.has(e.skuId)
        ? { text: routedNotes.get(e.skuId)!, source: "gemini" as const }
        : noteException(facts(e, skuById.get(e.skuId), data.planningMonth), templateExceptionNote(e)),
    );
    if (allExceptions.length)
      await db.insert(schema.exceptions).values(
        allExceptions.map((e, i) => ({
          runId: run.id, skuId: e.skuId, types: e.types, metrics: { ...e.metrics, ruleFlags: e.ruleFlags },
          aiNote: notes[i].text, aiNoteSource: notes[i].source,
        })),
      );

    const byFlag: Record<string, number> = {};
    for (const e of kept) for (const f of e.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;
    const sources = new Set(reviews.map((r) => r.source));
    const counts: RunSummary["counts"] = {
      evaluated: evaluations.length, flagged: kept.length, exceptions: allExceptions.length, byFlag,
      skippedNoStock: data.missingStock.length, aiRouted: routed.length,
      reasonSource: sources.size > 1 ? "mixed" : sources.has("gemini") ? "gemini" : "template",
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
