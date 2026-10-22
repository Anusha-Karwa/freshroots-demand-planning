import "./_env";

/**
 * One-time: exchange a Self Client grant code (valid ~10 minutes) for a long-lived refresh token.
 *   npm run zoho:refresh-token -- <grant-code>
 * Reads ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET from .env. Prints the refresh token once; put it in
 * ZOHO_REFRESH_TOKEN (local .env and Vercel). It is not saved anywhere else.
 */
const code = process.argv[2];
const accounts = process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in";
if (!code) {
  console.error("Usage: npm run zoho:refresh-token -- <grant-code>");
  process.exit(1);
}
if (!process.env.ZOHO_CLIENT_ID || !process.env.ZOHO_CLIENT_SECRET) {
  console.error("Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET first (api-console.zoho.in → Self Client).");
  process.exit(1);
}
const res = await fetch(`${accounts}/oauth/v2/token`, {
  method: "POST",
  body: new URLSearchParams({
    grant_type: "authorization_code",
    client_id: process.env.ZOHO_CLIENT_ID,
    client_secret: process.env.ZOHO_CLIENT_SECRET,
    code,
  }),
});
const json = (await res.json()) as { refresh_token?: string; error?: string };
if (!json.refresh_token) {
  console.error(`Zoho said: ${json.error ?? res.status}.`);
  if (json.error === "invalid_code") console.error("The grant code expired or was already used — generate a new one (Self Client → Generate Code).");
  if (json.error === "invalid_client") console.error("Client ID/secret don't match, or the account isn't on the India data centre (accounts.zoho.in).");
  process.exit(1);
}
console.log(`\nZOHO_REFRESH_TOKEN=${json.refresh_token}\n\nPut this in .env and in Vercel → Settings → Environment Variables. It is shown only once.`);
