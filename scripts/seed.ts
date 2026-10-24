/**
 * npm run seed                → load data/seed/*.csv (+ placeholder prices), print a summary
 * npm run seed -- --inspect   → only show the columns found in each file and how they map
 * npm run seed -- --sales path/to/file.csv   → use another file for one kind (skus, distributors, calendar, sales, inventory)
 */
import "./_env";
import fs from "node:fs";
import path from "node:path";
import { closeDb, databaseMode, getDb } from "@/db";
import { autoMap, FILE_KINDS, missingRequired, type FileKind } from "@/lib/data/columns";
import { readCsv } from "@/lib/data/parse";
import { formatSummaries, loadSeed, SEED_DIR } from "@/lib/data/load";

const args = process.argv.slice(2);
const files: Partial<Record<FileKind, string>> = {};
for (const kind of Object.keys(FILE_KINDS) as FileKind[]) {
  const i = args.indexOf(`--${kind}`);
  if (i >= 0 && args[i + 1]) files[kind] = args[i + 1];
}

function inspect() {
  for (const kind of ["skus", "distributors", "calendar", "sales", "inventory"] as FileKind[]) {
    const file = files[kind] ?? path.join(SEED_DIR, FILE_KINDS[kind].seedFile!);
    console.log(`\n${FILE_KINDS[kind].label} — ${file}`);
    if (!fs.existsSync(file)) { console.log("  (not found)"); continue; }
    const { headers, rows } = readCsv(fs.readFileSync(file, "utf8"));
    const map = autoMap(kind, headers);
    console.log(`  ${rows.length} rows; columns: ${headers.join(", ")}`);
    for (const f of FILE_KINDS[kind].fields) console.log(`  ${f.label.padEnd(40)} ← ${map[f.field] ?? (f.required ? "MISSING (required)" : "—")}`);
    const missing = missingRequired(kind, map);
    if (missing.length) console.log(`  ✗ cannot load: missing ${missing.join(", ")}`);
  }
}

async function main() {
  if (args.includes("--inspect")) return inspect();
  console.log(`Database: ${databaseMode() === "postgres" ? "Postgres (DATABASE_URL)" : "local PGlite (.data/pglite)"}`);
  const db = await getDb();
  const summaries = await loadSeed(db, "seed script", SEED_DIR, files);
  console.log(formatSummaries(summaries));
  const failed = summaries.some((s) => s.missingColumns.length);
  await closeDb();
  if (failed) process.exit(1);
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
