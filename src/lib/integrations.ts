/** Each integration is LIVE when its env vars are set, otherwise MOCK. Checked at call time. */

export type Mode = "live" | "mock";

export interface IntegrationStatus {
  key: string;
  name: string;
  mode: Mode;
  missing: string[];
  mockBehaviour: string;
}

const missing = (vars: string[]) => vars.filter((v) => !process.env[v]?.trim());

const SPECS = [
  {
    key: "database",
    name: "Postgres (Neon / Supabase)",
    vars: ["DATABASE_URL"],
    mockBehaviour: "Embedded local Postgres (PGlite) in ./.data/pglite",
  },
  {
    key: "gemini",
    name: "Gemini (flag explanations, exception notes)",
    vars: ["GEMINI_API_KEY", "GEMINI_MODEL"],
    mockBehaviour: "Template-based 2-line reasons built from the rule numbers",
  },
  {
    key: "zoho",
    name: "Zoho Inventory (draft purchase orders)",
    vars: [
      "ZOHO_CLIENT_ID",
      "ZOHO_CLIENT_SECRET",
      "ZOHO_REFRESH_TOKEN",
      "ZOHO_ORGANIZATION_ID",
      "ZOHO_DEFAULT_VENDOR_ID",
    ],
    mockBehaviour: "Draft POs written to mock_zoho_purchase_orders and labelled MOCK",
  },
  {
    key: "resend",
    name: "Resend (emails)",
    vars: ["RESEND_API_KEY", "EMAIL_FROM"],
    mockBehaviour: "Emails logged to the console and the mock_emails table",
  },
  {
    key: "cron",
    name: "Cron protection",
    vars: ["CRON_SECRET"],
    mockBehaviour: "Cron endpoints accept unauthenticated calls (local dev only)",
  },
  {
    key: "auth",
    name: "Dashboard login",
    vars: ["DASHBOARD_PASSWORD"],
    mockBehaviour: "No login; everyone is treated as the planner (local dev only)",
  },
] as const;

export type IntegrationKey = (typeof SPECS)[number]["key"];

export function integrationMode(key: IntegrationKey): Mode {
  const spec = SPECS.find((s) => s.key === key)!;
  return missing([...spec.vars]).length === 0 ? "live" : "mock";
}

export function integrationStatuses(): IntegrationStatus[] {
  return SPECS.map((s) => {
    const m = missing([...s.vars]);
    return { key: s.key, name: s.name, mode: m.length ? "mock" : "live", missing: m, mockBehaviour: s.mockBehaviour };
  });
}
