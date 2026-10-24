/** npm run db:migrate → applies pending migrations (the app also does this on first use). */
import "./_env";
import { closeDb, databaseMode, getDb } from "@/db";

getDb()
  .then(async () => {
    console.log(`Migrations applied (${databaseMode() === "postgres" ? "Postgres" : "local PGlite"}).`);
    await closeDb();
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
