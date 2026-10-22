import "./_env";
import { getDb, closeDb, dbMode } from "../src/lib/db";

await getDb();
console.log(`Migrations applied (${dbMode()}).`);
await closeDb();
