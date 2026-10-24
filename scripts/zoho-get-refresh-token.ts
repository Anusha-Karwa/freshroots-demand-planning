/**
 * npm run zoho:refresh-token -- <grant code>
 * Exchanges a one-time grant code (Zoho API console → Self Client → Generate Code, valid ~10 minutes) for a
 * refresh token. Reads ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET from .env. Prints the token once; nothing is saved.
 */
import "./_env";
import { zohoAccountsUrl } from "@/lib/integrations";

async function main() {
  const code = process.argv[2]?.trim();
  const id = process.env.ZOHO_CLIENT_ID?.trim();
  const secret = process.env.ZOHO_CLIENT_SECRET?.trim();
  if (!code) throw new Error("Usage: npm run zoho:refresh-token -- <grant code>");
  if (!id || !secret) throw new Error("Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in .env first.");
  const res = await fetch(`${zohoAccountsUrl()}/oauth/v2/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: id, client_secret: secret, code }),
  });
  const json = (await res.json()) as { refresh_token?: string; error?: string; scope?: string };
  if (!json.refresh_token) {
    const hints: Record<string, string> = {
      invalid_code: "The grant code is wrong, already used, or expired (they last ~10 minutes). Generate a new one.",
      invalid_client: "Client id/secret are wrong, or this isn't the India data centre (accounts.zoho.in).",
    };
    throw new Error(`Zoho said: ${json.error ?? res.status}. ${hints[json.error ?? ""] ?? ""}`);
  }
  console.log("\nRefresh token (shown once — put it in .env and in Vercel as ZOHO_REFRESH_TOKEN):\n");
  console.log(json.refresh_token);
  if (json.scope) console.log(`\nScopes: ${json.scope}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
