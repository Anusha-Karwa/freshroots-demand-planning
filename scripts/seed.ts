import "./_env";
import fs from "node:fs";
import path from "node:path";
import { closeDb, dbMode } from "../src/lib/db";
import { FILE_SPECS, LOAD_ORDER, type FileType } from "../src/lib/seed/columns";
import { formatReport, inspectFile, loadFiles } from "../src/lib/seed/loader";
import { ensureDefaults } from "../src/lib/settings";

/**
 * npm run seed                         load the five files from data/seed/
 * npm run seed -- --inspect            show columns found + mapping, load nothing
 * npm run seed -- --dir data/sample    load from another folder
 * npm run seed -- --skus my_skus.csv   override one file's path
 * npm run seed -- --prices file.csv    placeholder prices for SKUs without cost/price (default data/placeholder_prices.csv)
 */
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const dir = flag("dir") ?? "data/seed";
const inspectOnly = args.includes("--inspect");

const files: Partial<Record<FileType, string>> = {};
for (const type of LOAD_ORDER) {
  const p = flag(type) ?? flag(type.replace("_", "-")) ?? path.join(dir, FILE_SPECS[type].defaultFile);
  if (fs.existsSync(p)) files[type] = p;
}

const missing = LOAD_ORDER.filter((t) => !files[t]);
if (!Object.keys(files).length) {
  console.error(`No seed files found in ${dir}/. Expected: ${LOAD_ORDER.map((t) => FILE_SPECS[t].defaultFile).join(", ")}`);
  process.exit(1);
}
if (missing.length) console.warn(`⚠ Not found (skipped): ${missing.map((t) => FILE_SPECS[t].defaultFile).join(", ")}`);

if (inspectOnly) {
  for (const type of LOAD_ORDER) {
    const p = files[type];
    if (!p) continue;
    const info = await inspectFile(type, p);
    console.log(`\n━━ ${type} — ${p} (${info.rows.toLocaleString("en-IN")} rows)`);
    console.log(`   columns: ${info.headers.join(", ")}`);
    for (const f of FILE_SPECS[type].fields) {
      const h = info.mapping.mapped[f.field];
      const tag = h ? `← "${h}"` : f.required ? "✗ MISSING (required)" : "– not found (optional)";
      console.log(`   ${f.field.padEnd(18)} ${tag}${f.note ? `   [${f.note}]` : ""}`);
    }
    if (info.mapping.unmapped.length) console.log(`   unmapped (kept as 'extra'): ${info.mapping.unmapped.join(", ")}`);
    if (info.sample[0]) console.log(`   first row: ${JSON.stringify(info.sample[0])}`);
  }
  process.exit(0);
}

console.log(`Database: ${dbMode()}`);
const t0 = Date.now();
await ensureDefaults();
const report = await loadFiles(files, {
  source: "seed",
  replace: true,
  placeholderPricesFile: flag("prices") ?? "data/placeholder_prices.csv",
  log: (m) => console.log(m),
});
console.log(formatReport(report));
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
await closeDb();
if (report.blocked) {
  console.error("\n✗ At least one file was not loaded because a required column is missing. Fix the file or add an alias in src/lib/seed/columns.ts.");
  process.exit(1);
}
if (report.checks.some((c) => !c.passed)) process.exit(2);
