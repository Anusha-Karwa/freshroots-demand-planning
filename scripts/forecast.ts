import "./_env";
import { closeDb } from "../src/lib/db";
import { runForecast } from "../src/lib/rules/run";
import { FLAG_LABEL, EXCEPTION_LABEL } from "../src/lib/rules/reason";

/** npm run forecast — run the rules on the loaded data and save the run (same as the cron job). */
const r = await runForecast("manual");
console.log(`Run #${r.runId} · data as of ${r.dataAsOf} · planning week ${r.planningWeek} (month ${r.planningMonth}) · rules v${r.rulesVersion}`);
console.log(`Evaluated ${r.counts.evaluated}, flagged ${r.counts.flagged}, exceptions ${r.counts.exceptions}\n`);
for (const e of r.evaluations) {
  const m = e.metrics;
  const nums = `4wk ${m.avg4} vs 12wk ${m.avg12} (${m.pct4v12 ?? "–"}%) · stock ${m.stockOnHand} · cover ${m.weeksOfCover ?? "–"} wk [${m.coverWindow.minWeeks}–${m.coverWindow.maxWeeks}] · WoW ${m.wowPct ?? "–"}%`;
  const what =
    e.kind === "flag" ? `${e.flags.map((f) => FLAG_LABEL[f]).join(" + ")} → ${e.action} ${e.recommendedQty}`
    : e.kind === "exception" ? `EXCEPTION: ${e.types.map((t) => EXCEPTION_LABEL[t]).join(", ")}`
    : "ok";
  console.log(`${e.skuId.padEnd(8)} ${what.padEnd(48)} ${nums}`);
}
await closeDb();
