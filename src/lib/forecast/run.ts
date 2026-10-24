import { and, desc, eq, gte, lte } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { addDays, todayIst } from "@/lib/dates";
import { explainFlags, type ExplainInput } from "@/lib/adapters/gemini";
import { evaluateSku, type Evaluation } from "@/lib/rules/engine";
import { templateReason } from "@/lib/rules/reason";
import { getRules } from "@/lib/settings";
import { loadEngineData, type SkuInfo } from "./inputs";

export interface RunResult {
  runId: number;
  planningDate: string;
  dataThrough: string;
  counts: Record<string, number>;
  reasonSource: "gemini" | "template";
  geminiErrors: string[];
}

/**
 * The twice-weekly run (components map: System → Processing → AI):
 * latest loaded SAP data → rules engine (no AI) → Gemini reasons + "looks unusual" routing → saved for Raghav.
 * Nothing is ordered here; Raghav decides on the Review page.
 */
export async function runForecast(db: Db, opts: { trigger: "cron" | "manual" | "script"; planningDate?: string }): Promise<RunResult> {
  const planningDate = opts.planningDate ?? todayIst();
  const rules = await getRules(db);
  const data = await loadEngineData(db);
  if (!data.lastWeek) throw new Error("No sales data loaded yet. Load the seed data or upload a SAP export on the Data page.");
  const dataThrough = addDays(data.lastWeek, 6); // Sunday of the latest week

  const [run] = await db.insert(schema.runs).values({
    trigger: opts.trigger, status: "running", planningDate, dataThrough, stockAsOf: data.stockAsOf, rulesVersionId: rules.id,
  }).returning();

  try {
    const evaluations = data.inputs.map((input) => evaluateSku(input, rules.config, planningDate));
    const flagged = evaluations.filter((e) => e.queue !== "none");

    const context = await marketContext(db, planningDate);
    const explainInputs: ExplainInput[] = flagged.map((e) => {
      const sku = data.skus.get(e.skuId)!;
      return {
        skuId: e.skuId, name: sku.name, category: sku.category, flags: e.flags, exceptions: e.exceptions,
        metrics: geminiFacts(e), template: templateReason(e), context: context(sku),
      };
    });
    const explained = await explainFlags(explainInputs);
    const bySku = new Map(explained.results.map((r) => [r.skuId, r]));

    const rows = evaluations.map((e) => {
      const ex = bySku.get(e.skuId);
      // Gemini may move a rule flag to the exceptions queue; it never changes the numbers.
      const aiRouted = ex?.unusual && e.queue === "review";
      return {
        runId: run.id,
        skuId: e.skuId,
        queue: aiRouted ? "exception" : e.queue,
        flags: e.flags,
        exceptions: aiRouted ? [...e.exceptions, "AI_UNUSUAL"] : e.exceptions,
        metrics: e.metrics,
        forecastWeekly: e.metrics.expectedWeekly,
        recommendedQty: aiRouted ? null : e.recommendedQty,
        action: aiRouted ? "judgement" : e.action,
        reason: e.queue === "none" ? null : ex?.reason ?? templateReason(e),
        reasonSource: e.queue === "none" ? null : ex?.source ?? "template",
        aiNote: ex?.note || null,
      };
    });
    for (let i = 0; i < rows.length; i += 200) await db.insert(schema.runItems).values(rows.slice(i, i + 200));

    const counts = {
      skus: rows.length,
      review: rows.filter((r) => r.queue === "review").length,
      exceptions: rows.filter((r) => r.queue === "exception").length,
      highDemand: rows.filter((r) => r.flags.includes("HIGH_DEMAND")).length,
      stockoutRisk: rows.filter((r) => r.flags.includes("STOCKOUT_RISK")).length,
      overstockRisk: rows.filter((r) => r.flags.includes("OVERSTOCK_RISK")).length,
      aiRouted: rows.filter((r) => r.exceptions.includes("AI_UNUSUAL")).length,
    };
    await db.update(schema.runs).set({
      status: "done", finishedAt: new Date(), summary: counts, reasonSource: explained.source,
      error: explained.errors.length ? `Gemini fell back to templates for some items: ${explained.errors[0]}` : null,
    }).where(eq(schema.runs.id, run.id));

    return { runId: run.id, planningDate, dataThrough, counts, reasonSource: explained.source, geminiErrors: explained.errors };
  } catch (err) {
    await db.update(schema.runs).set({ status: "failed", finishedAt: new Date(), error: String(err) }).where(eq(schema.runs.id, run.id));
    throw err;
  }
}

/** The numbers Gemini may quote (no quantities). */
function geminiFacts(e: Evaluation) {
  const m = e.metrics;
  return {
    last4WeeksAvg: m.avgShort, last12WeeksAvg: m.avgLong, changePct: m.changePct, festivalMonth: m.festival,
    expectedWeekly: m.expectedWeekly, stock: m.stock, weeksOfCover: m.weeksCover, coverWindowWeeks: `${m.minCoverWeeks}-${m.maxCoverWeeks}`,
    perishable: m.perishable, lastWeek: m.lastWeek, previousWeek: m.prevWeek, weekOnWeekPct: m.wowPct, weeksOfHistory: m.weeksOfHistory,
    topDistributor: m.topDistributor,
  };
}

/** Festival / competitor-scheme notes around the planning date, per SKU. */
async function marketContext(db: Db, planningDate: string) {
  const [month] = await db.select().from(schema.calendarMonths).where(eq(schema.calendarMonths.yearMonth, planningDate.slice(0, 7)));
  const events = await db.select().from(schema.marketEvents).where(and(
    lte(schema.marketEvents.startDate, addDays(planningDate, 28)),
    gte(schema.marketEvents.endDate, addDays(planningDate, -28)),
  ));
  return (sku: SkuInfo) => {
    const notes: string[] = [];
    if (month?.isFestival) notes.push(`Festival month${month.festivalName ? ` (${month.festivalName})` : ""}.`);
    if (month?.competitorScheme) notes.push(`Competitor scheme this month: ${month.competitorScheme}.`);
    for (const ev of events) {
      if (ev.skuId && ev.skuId !== sku.id) continue;
      if (ev.category && ev.category !== sku.category) continue;
      notes.push(`${ev.kind.replace("_", " ")} ${ev.startDate}→${ev.endDate}: ${ev.description}`);
    }
    return notes;
  };
}

export async function latestRun(db: Db) {
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.status, "done")).orderBy(desc(schema.runs.id)).limit(1);
  return run ?? null;
}
