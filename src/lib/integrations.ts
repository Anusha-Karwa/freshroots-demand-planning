/**
 * Every external service has a LIVE mode (its keys are set) and a MOCK mode (keys missing), so the app runs
 * end-to-end with zero keys. Adding the keys in .env / Vercel switches a service to live; nothing else changes.
 */

export type Service = "database" | "gemini" | "zoho" | "email" | "cron" | "auth";

const REQUIRED: Record<Service, string[]> = {
  database: ["DATABASE_URL"],
  gemini: ["GEMINI_API_KEY"],
  zoho: ["ZOHO_CLIENT_ID", "ZOHO_CLIENT_SECRET", "ZOHO_REFRESH_TOKEN", "ZOHO_ORGANIZATION_ID"],
  email: ["RESEND_API_KEY", "EMAIL_FROM"],
  cron: ["CRON_SECRET"],
  auth: ["DASHBOARD_PASSWORD"],
};

export const SERVICE_INFO: Record<Service, { name: string; live: string; mock: string }> = {
  database: { name: "Postgres (Neon)", live: "Neon Postgres via DATABASE_URL", mock: "Embedded local Postgres (PGlite) in .data/pglite" },
  gemini: { name: "Gemini", live: "Writes the 2-line reason per flag and spots unusual cases", mock: "Template reasons built from the rule numbers" },
  zoho: { name: "Zoho Inventory", live: "Creates draft purchase orders in Zoho (India DC)", mock: "Draft POs saved to the mock_zoho_purchase_orders table, labelled MOCK" },
  email: { name: "Resend email", live: "Sends emails through Resend", mock: "Emails logged to the console and the mock_emails table" },
  cron: { name: "Vercel Cron", live: "Cron endpoints require the CRON_SECRET bearer token", mock: "Cron endpoints are open (local dev only)" },
  auth: { name: "Dashboard login", live: "Password login with planner / viewer roles", mock: "No login: everyone is the planner (local dev only)" },
};

const isSet = (name: string) => Boolean(process.env[name]?.trim());

export const missingVars = (s: Service) => REQUIRED[s].filter((v) => !isSet(v));
export const mode = (s: Service): "live" | "mock" => (missingVars(s).length ? "mock" : "live");

export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-flash-latest";
export const zohoAccountsUrl = () => (process.env.ZOHO_ACCOUNTS_URL?.trim() || "https://accounts.zoho.in").replace(/\/$/, "");
export const zohoApiBase = () => (process.env.ZOHO_API_BASE?.trim() || "https://www.zohoapis.in/inventory/v1").replace(/\/$/, "");
export const appUrl = () =>
  (process.env.APP_BASE_URL?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")).replace(/\/$/, "");

export function integrationStatus() {
  return (Object.keys(REQUIRED) as Service[]).map((s) => ({ service: s, ...SERVICE_INFO[s], mode: mode(s), missing: missingVars(s) }));
}
