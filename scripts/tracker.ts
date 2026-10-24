/** npm run tracker → the daily 07:00 check: actual vs forecast, stockouts, PO sync, kill switch. */
import "./_env";
import { closeDb, getDb } from "@/db";
import { runTracker } from "@/lib/tracker";

getDb()
  .then(async (db) => {
    console.log(await runTracker(db));
    await closeDb();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
