import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { integrationMode } from "@/lib/integrations";

/**
 * Zoho Inventory (India data centre). Live when all ZOHO_* vars are set, otherwise mock.
 * Purchase orders are only ever created as drafts — never marked issued or sent. Procurement confirms in Zoho.
 */

export interface DraftPoLine {
  skuId: string;
  zohoItemId?: string | null;
  name: string;
  quantity: number;
  rate: number;
}

export interface DraftPoInput {
  vendorId: string; // Zoho vendor id (live) or our supplier id (mock)
  referenceNumber: string; // our PO id, so procurement can trace it back
  date: string; // YYYY-MM-DD
  notes: string;
  lines: DraftPoLine[];
}

export interface DraftPoResult {
  mode: "live" | "mock";
  purchaseOrderId: string;
  purchaseOrderNumber: string;
  status: string;
}

/** Zoho Inventory PO body. */
export function toZohoPayload(input: DraftPoInput) {
  return {
    vendor_id: input.vendorId,
    reference_number: input.referenceNumber,
    date: input.date,
    notes: input.notes,
    line_items: input.lines.map((l) => ({
      ...(l.zohoItemId ? { item_id: l.zohoItemId } : { name: l.name }),
      description: l.skuId,
      quantity: l.quantity,
      rate: l.rate,
    })),
  };
}

// ---------------------------------------------------------------------------
// Live client
// ---------------------------------------------------------------------------

const env = () => ({
  accounts: process.env.ZOHO_ACCOUNTS_URL || "https://accounts.zoho.in",
  api: process.env.ZOHO_API_BASE || "https://www.zohoapis.in/inventory/v1",
  org: process.env.ZOHO_ORGANIZATION_ID!,
});

type Fetch = typeof fetch;
let token: { value: string; expiresAt: number } | null = null;

/** Exchange the refresh token for an access token; cached until a minute before it expires. */
export async function accessToken(f: Fetch = fetch, now = Date.now()): Promise<string> {
  if (token && token.expiresAt > now + 60_000) return token.value;
  const body = new URLSearchParams({
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    grant_type: "refresh_token",
  });
  const res = await f(`${env().accounts}/oauth/v2/token`, { method: "POST", body });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token)
    throw new Error(`Zoho token refresh failed (${res.status}): ${json.error ?? "no access_token"} — check ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN and that ZOHO_ACCOUNTS_URL is the .in data centre.`);
  token = { value: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
  return token.value;
}

export const resetZohoTokenCache = () => void (token = null);

async function log(entry: typeof schema.zohoApiLog.$inferInsert) {
  try {
    await (await getDb()).insert(schema.zohoApiLog).values(entry);
  } catch (err) {
    console.error("[zoho] could not write API log:", err);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Zoho API call: adds the org id and auth header, retries 429 / 5xx up to 3 times (honouring Retry-After),
 * refreshes the token once on 401, logs a request/response summary, and throws Zoho's own message on failure.
 */
export async function zohoRequest<T = Record<string, unknown>>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: { f?: Fetch; summary?: string; retryDelayMs?: number } = {},
): Promise<T> {
  const f = opts.f ?? fetch;
  const url = `${env().api}${path}${path.includes("?") ? "&" : "?"}organization_id=${env().org}`;
  let refreshed = false;
  for (let attempt = 0; ; attempt++) {
    const res = await f(url, {
      method,
      headers: { Authorization: `Zoho-oauthtoken ${await accessToken(f)}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
    await log({
      mode: "live", method, path, statusCode: res.status,
      requestSummary: opts.summary ?? null,
      responseSummary: `${json.code ?? ""} ${json.message ?? ""}`.trim().slice(0, 300) || null,
    });
    if (res.status === 401 && !refreshed) {
      refreshed = true;
      resetZohoTokenCache();
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || (opts.retryDelayMs ?? 1000) * 2 ** attempt;
      await sleep(wait);
      continue;
    }
    if (!res.ok || (json.code !== undefined && json.code !== 0))
      throw new Error(`Zoho ${method} ${path} failed (${res.status}, code ${json.code ?? "—"}): ${json.message ?? "no message"}`);
    return json;
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

export async function createDraftPurchaseOrder(input: DraftPoInput): Promise<DraftPoResult> {
  const payload = toZohoPayload(input);
  const summary = `vendor=${input.vendorId} lines=${input.lines.length} ref=${input.referenceNumber}`;
  if (integrationMode("zoho") === "live") {
    // No "issue"/"send" call follows: the PO stays a draft until procurement confirms it in Zoho.
    const json = await zohoRequest<{ purchaseorder: { purchaseorder_id: string; purchaseorder_number: string; status: string } }>(
      "POST", "/purchaseorders", payload, { summary },
    );
    const po = json.purchaseorder;
    return { mode: "live", purchaseOrderId: po.purchaseorder_id, purchaseOrderNumber: po.purchaseorder_number, status: po.status };
  }
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.mockZohoPurchaseOrders);
  const number = `MOCK-PO-${String(n + 1).padStart(5, "0")}`;
  const [row] = await db
    .insert(schema.mockZohoPurchaseOrders)
    .values({ purchaseOrderNumber: number, payload, status: "draft" })
    .returning({ id: schema.mockZohoPurchaseOrders.id });
  await log({ mode: "mock", method: "POST", path: "/purchaseorders", statusCode: 201, requestSummary: summary, responseSummary: `draft ${number}` });
  return { mode: "mock", purchaseOrderId: `mock-${row.id}`, purchaseOrderNumber: number, status: "draft" };
}

/** Current status of a PO in Zoho (draft / open / issued / billed / cancelled…). */
export async function getPurchaseOrderStatus(purchaseOrderId: string): Promise<string> {
  if (purchaseOrderId.startsWith("mock-")) {
    const db = await getDb();
    const [row] = await db
      .select({ status: schema.mockZohoPurchaseOrders.status })
      .from(schema.mockZohoPurchaseOrders)
      .where(sql`${schema.mockZohoPurchaseOrders.id} = ${Number(purchaseOrderId.slice(5))}`);
    return row?.status ?? "unknown";
  }
  const json = await zohoRequest<{ purchaseorder: { status: string } }>("GET", `/purchaseorders/${purchaseOrderId}`);
  return json.purchaseorder.status;
}

/** Creates an item in Zoho for a SKU (used by npm run zoho:sync-items). Returns the Zoho item id. */
export async function createItem(sku: { skuId: string; name: string; unitCost: number | null; unitPrice: number | null }) {
  const json = await zohoRequest<{ item: { item_id: string } }>(
    "POST",
    "/items",
    { name: sku.name, sku: sku.skuId, rate: sku.unitPrice ?? 0, purchase_rate: sku.unitCost ?? 0, item_type: "inventory", product_type: "goods" },
    { summary: `item ${sku.skuId}` },
  );
  return json.item.item_id;
}

export async function listOrganizations() {
  return zohoRequest<{ organizations: { organization_id: string; name: string }[] }>("GET", "/organizations");
}
