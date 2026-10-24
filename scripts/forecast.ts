/** npm run forecast [-- --date 2026-10-26] → runs the rules on the latest loaded data, like the Mon/Thu cron. */
import "./_env";
import { closeDb, getDb } from "@/db";
import { runForecast } from "@/lib/forecast/run";

async function main() {
  const i = process.argv.indexOf("--date");
  const db = await getDb();
  const r = await runForecast(db, { trigger: "script", planningDate: i > 0 ? process.argv[i + 1] : undefined });
  console.log(`Run #${r.runId} for ${r.planningDate} (data through ${r.dataThrough}), reasons by ${r.reasonSource}`);
  console.log(r.counts);
  if (r.geminiErrors.length) console.log("Gemini errors:", r.geminiErrors);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
