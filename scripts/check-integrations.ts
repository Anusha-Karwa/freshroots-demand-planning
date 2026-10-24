/** npm run check:integrations → shows Live/Mock per service and pings the live ones. */
import "./_env";
import { closeDb, getDb, schema } from "@/db";
import { pingGemini } from "@/lib/adapters/gemini";
import { liveClient } from "@/lib/adapters/zoho";
import { geminiModel, integrationStatus } from "@/lib/integrations";

async function main() {
  for (const s of integrationStatus()) console.log(`${s.mode === "live" ? "LIVE" : "mock"}  ${s.name.padEnd(18)} ${s.missing.length ? `missing: ${s.missing.join(", ")}` : ""}`);
  const status = Object.fromEntries(integrationStatus().map((s) => [s.service, s.mode]));
  const check = async (name: string, fn: () => Promise<string>) => {
    try { console.log(`✓ ${name}: ${await fn()}`); } catch (err) { console.log(`✗ ${name}: ${err instanceof Error ? err.message : err}`); }
  };
  await check("database", async () => {
    const db = await getDb();
    const rows = await db.select({ id: schema.skus.id }).from(schema.skus);
    return `${rows.length} SKUs`;
  });
  if (status.gemini === "live") await check(`gemini (${geminiModel()})`, pingGemini);
  if (status.zoho === "live") await check("zoho", async () => (await liveClient().organizations()).map((o) => o.name).join(", "));
  if (status.email === "live") console.log("  email: use the Test button on the Integrations page to send a real test email.");
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb().catch(() => undefined);
  process.exit(1);
});
