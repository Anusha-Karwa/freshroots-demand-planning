import { count, eq } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { mode, zohoAccountsUrl, zohoApiBase } from "@/lib/integrations";

/**
 * Zoho Inventory (India data centre). Purchase orders are only ever created as DRAFTS — procurement reviews
 * and issues them inside Zoho. Without Zoho keys the mock adapter stores the same payload in
 * mock_zoho_purchase_orders instead.
 */

export interface PoLineInput { skuId: string; name: string; unit: string; qty: number; rate: number; zohoItemId: string | null }
export interface PoInput { vendorId: string; date: string; reference: string; notes: string; lines: PoLineInput[] }
export interface PoResult { id: string; number: string; status: string; itemIds: Record<string, string> }

export interface ZohoAdapter {
  mode: "live" | "mock";
  createDraftPurchaseOrder(po: PoInput): Promise<PoResult>;
  getPurchaseOrderStatus(id: string): Promise<string>;
}

export class ZohoError extends Error {
  constructor(message: string, public status: number | null, public code: number | null) { super(message); }
}

// ---------------- Live ----------------

type Fetch = typeof fetch;
type Log = (entry: { method: string; path: string; status: number | null; summary: string }) => Promise<void>;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exported for tests (they pass a fake fetch). */
export class ZohoClient {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private cfg: { clientId: string; clientSecret: string; refreshToken: string; orgId: string; accountsUrl: string; apiBase: string },
    private log: Log = async () => undefined,
    private fetcher: Fetch = fetch,
    private wait: (ms: number) => Promise<void> = sleep,
  ) {}

  /** Exchanges the refresh token for an access token, cached until a minute before it expires. */
  async accessToken(force = false): Promise<string> {
    if (!force && this.token && Date.now() < this.token.expiresAt) return this.token.value;
    const body = new URLSearchParams({
      refresh_token: this.cfg.refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, grant_type: "refresh_token",
    });
    const res = await this.fetcher(`${this.cfg.accountsUrl}/oauth/v2/token`, { method: "POST", body });
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    await this.log({ method: "POST", path: "/oauth/v2/token", status: res.status, summary: json.access_token ? "access token refreshed" : `error: ${json.error ?? res.statusText}` });
    if (!json.access_token) {
      const hint = json.error === "invalid_code" ? " (refresh token is wrong or revoked — generate a new one)"
        : json.error === "invalid_client" ? " (client id/secret wrong, or not the India data centre)" : "";
      throw new ZohoError(`Zoho token refresh failed: ${json.error ?? res.status}${hint}`, res.status, null);
    }
    this.token = { value: json.access_token, expiresAt: Date.now() + ((json.expires_in ?? 3600) - 60) * 1000 };
    return this.token.value;
  }

  /** Calls the Inventory API. Retries 429 / 5xx with backoff and re-authenticates once on 401. */
  async request<T = Record<string, unknown>>(method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.cfg.apiBase}${path}`);
    url.searchParams.set("organization_id", this.cfg.orgId);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    let reauthed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const res = await this.fetcher(url, {
        method,
        headers: { Authorization: `Zoho-oauthtoken ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = (await res.json().catch(() => ({}))) as { code?: number; message?: string } & T;
      await this.log({ method, path, status: res.status, summary: `code ${json.code ?? "?"}: ${json.message ?? res.statusText}`.slice(0, 300) });
      if (res.status === 401 && !reauthed) {
        reauthed = true;
        this.token = null;
        continue;
      }
      if ((res.status === 429 || res.status >= 500) && attempt < 3) {
        const retryAfter = Number(res.headers.get("retry-after"));
        await this.wait(retryAfter > 0 ? retryAfter * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      if (!res.ok || (json.code !== undefined && json.code !== 0)) {
        throw new ZohoError(`Zoho ${method} ${path} failed (${res.status}, code ${json.code ?? "?"}): ${json.message ?? res.statusText}`, res.status, json.code ?? null);
      }
      return json;
    }
  }

  async organizations() {
    const r = await this.request<{ organizations?: { organization_id: string; name: string }[] }>("GET", "/organizations");
    return r.organizations ?? [];
  }

  /** Finds the Zoho item for a SKU (by its SKU code), creating it if missing. */
  async ensureItem(sku: { id: string; name: string; unit: string; unitCost: number | null; unitPrice: number | null }): Promise<string> {
    const found = await this.request<{ items?: { item_id: string; sku?: string }[] }>("GET", "/items", undefined, { sku: sku.id });
    const hit = found.items?.find((i) => i.sku === sku.id);
    if (hit) return hit.item_id;
    const base = { name: `${sku.name} (${sku.id})`, sku: sku.id, unit: sku.unit, rate: sku.unitPrice ?? 0, purchase_rate: sku.unitCost ?? 0, product_type: "goods" };
    try {
      const r = await this.request<{ item: { item_id: string } }>("POST", "/items", { ...base, item_type: "inventory" });
      return r.item.item_id;
    } catch (err) {
      // Organisations without inventory tracking set up reject "inventory" items; a purchasable item still works on POs.
      if (!(err instanceof ZohoError) || !/account|inventory|track/i.test(err.message)) throw err;
      const r = await this.request<{ item: { item_id: string } }>("POST", "/items", { ...base, item_type: "sales_and_purchases" });
      return r.item.item_id;
    }
  }

  async createDraftPurchaseOrder(po: PoInput, ensure?: (line: PoLineInput) => Promise<string>): Promise<PoResult> {
    const itemIds: Record<string, string> = {};
    for (const l of po.lines) itemIds[l.skuId] = l.zohoItemId ?? (ensure ? await ensure(l) : "");
    const body = {
      vendor_id: po.vendorId,
      date: po.date,
      reference_number: po.reference,
      notes: po.notes,
      line_items: po.lines.map((l) => ({ item_id: itemIds[l.skuId], quantity: l.qty, rate: l.rate, description: `${l.skuId} ${l.name}` })),
    };
    // No "issue"/"mark as open" call follows: the PO stays a draft for procurement to confirm.
    const r = await this.request<{ purchaseorder: { purchaseorder_id: string; purchaseorder_number: string; status: string } }>("POST", "/purchaseorders", body);
    return { id: r.purchaseorder.purchaseorder_id, number: r.purchaseorder.purchaseorder_number, status: r.purchaseorder.status, itemIds };
  }

  async getPurchaseOrderStatus(id: string) {
    const r = await this.request<{ purchaseorder: { status: string } }>("GET", `/purchaseorders/${id}`);
    return r.purchaseorder.status;
  }
}

// One client per process, so the access token is reused until it expires. Every call is logged to zoho_api_log.
let shared: { client: ZohoClient; logTo: { db?: Db } } | null = null;

export function liveClient(db?: Db): ZohoClient {
  if (!shared) {
    const logTo: { db?: Db } = {};
    const client = new ZohoClient({
      clientId: process.env.ZOHO_CLIENT_ID!, clientSecret: process.env.ZOHO_CLIENT_SECRET!, refreshToken: process.env.ZOHO_REFRESH_TOKEN!,
      orgId: process.env.ZOHO_ORGANIZATION_ID!, accountsUrl: zohoAccountsUrl(), apiBase: zohoApiBase(),
    }, async (e) => {
      if (logTo.db) await logTo.db.insert(schema.zohoApiLog).values(e).catch(() => undefined);
    });
    shared = { client, logTo };
  }
  if (db) shared.logTo.db = db;
  return shared.client;
}

// ---------------- Adapter ----------------

export function zohoAdapter(db: Db): ZohoAdapter {
  if (mode("zoho") === "live") {
    const client = liveClient(db);
    return {
      mode: "live",
      createDraftPurchaseOrder: (po) => client.createDraftPurchaseOrder(po, async (line) => {
        const [sku] = await db.select().from(schema.skus).where(eq(schema.skus.id, line.skuId));
        const id = await client.ensureItem({ id: line.skuId, name: line.name, unit: line.unit, unitCost: sku?.unitCost ?? null, unitPrice: sku?.unitPrice ?? null });
        await db.update(schema.skus).set({ zohoItemId: id }).where(eq(schema.skus.id, line.skuId));
        return id;
      }),
      getPurchaseOrderStatus: (id) => client.getPurchaseOrderStatus(id),
    };
  }
  return {
    mode: "mock",
    async createDraftPurchaseOrder(po) {
      const [{ n }] = await db.select({ n: count() }).from(schema.mockZohoPurchaseOrders);
      const number = `MOCK-PO-${String(n + 1).padStart(5, "0")}`;
      const [row] = await db.insert(schema.mockZohoPurchaseOrders).values({ poNumber: number, status: "draft", payload: po }).returning();
      return { id: `mock-${row.id}`, number, status: "draft", itemIds: {} };
    },
    async getPurchaseOrderStatus(id) {
      const [row] = await db.select().from(schema.mockZohoPurchaseOrders).where(eq(schema.mockZohoPurchaseOrders.id, Number(id.replace("mock-", ""))));
      return row?.status ?? "draft";
    },
  };
}
