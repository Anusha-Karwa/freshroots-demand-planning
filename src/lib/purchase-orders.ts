import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { User } from "@/lib/auth";
import { integrationMode } from "@/lib/integrations";
import { createDraftPurchaseOrder, getPurchaseOrderStatus } from "@/lib/adapters/zoho";
import { latestRun } from "@/lib/queries";
import { todayIST } from "@/lib/tracker";

/**
 * Raghav's approved lines → one draft PO per supplier → Zoho (or mock). Only the latest run's lines are
 * used, so an older approval can't double-order a SKU. Procurement confirms the draft inside Zoho.
 */

export interface OrderLine {
  source: "recommendation" | "exception";
  id: number;
  skuId: string;
  name: string;
  vendorId: string | null;
  zohoItemId: string | null;
  quantity: number;
  unitCost: number | null;
  priceSource: string | null;
}

export interface VendorGroup {
  supplierId: string; // our supplier id (SKU file's Distributor_ID), or "DEFAULT"
  zohoVendorId: string; // where the PO goes
  lines: OrderLine[];
  totalValue: number;
  placeholderPrices: boolean;
}

export const DEFAULT_SUPPLIER = "DEFAULT";

/** Group lines by supplier and map each supplier to a Zoho vendor id. Pure, for testing. */
export function groupByVendor(lines: OrderLine[], vendorMap: Record<string, string>, defaultVendor: string | undefined): VendorGroup[] {
  const groups = new Map<string, OrderLine[]>();
  for (const l of lines) {
    if (l.quantity <= 0) continue;
    const key = l.vendorId || DEFAULT_SUPPLIER;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([supplierId, ls]) => ({
      supplierId,
      zohoVendorId: vendorMap[supplierId] || defaultVendor || supplierId,
      lines: ls.sort((a, b) => a.skuId.localeCompare(b.skuId)),
      totalValue: ls.reduce((a, l) => a + l.quantity * (l.unitCost ?? 0), 0),
      placeholderPrices: ls.some((l) => l.priceSource === "placeholder"),
    }));
}

export async function vendorMap(): Promise<Record<string, string>> {
  const db = await getDb();
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "zoho_vendor_map"));
  return (row?.value as Record<string, string>) ?? {};
}

export async function saveVendorMap(map: Record<string, string>, user: User) {
  const db = await getDb();
  const value = Object.fromEntries(Object.entries(map).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
  await db
    .insert(schema.appSettings)
    .values({ key: "zoho_vendor_map", value, updatedBy: user.name })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedBy: user.name, updatedAt: new Date() } });
}

/** Approved / edited recommendations with qty > 0 and "order" exceptions from the latest run, not yet on a PO. */
export async function readyLines(): Promise<{ runId: number | null; dataAsOf: string | null; lines: OrderLine[] }> {
  const run = await latestRun();
  if (!run) return { runId: null, dataAsOf: null, lines: [] };
  const db = await getDb();
  const recs = await db
    .select({ r: schema.recommendations, s: schema.skus })
    .from(schema.recommendations)
    .innerJoin(schema.skus, eq(schema.skus.skuId, schema.recommendations.skuId))
    .where(
      and(
        eq(schema.recommendations.runId, run.id),
        inArray(schema.recommendations.status, ["approved", "edited"]),
        sql`${schema.recommendations.finalQty} > 0`,
        isNull(schema.recommendations.purchaseOrderId),
      ),
    );
  const exs = await db
    .select({ e: schema.exceptions, s: schema.skus })
    .from(schema.exceptions)
    .innerJoin(schema.skus, eq(schema.skus.skuId, schema.exceptions.skuId))
    .where(and(eq(schema.exceptions.runId, run.id), eq(schema.exceptions.status, "ordered"), isNull(schema.exceptions.purchaseOrderId)));
  const line = (source: OrderLine["source"], id: number, s: typeof schema.skus.$inferSelect, quantity: number): OrderLine => ({
    source, id, skuId: s.skuId, name: s.name, vendorId: s.vendorId, zohoItemId: s.zohoItemId, quantity,
    unitCost: s.unitCost, priceSource: s.priceSource,
  });
  return {
    runId: run.id,
    dataAsOf: run.dataAsOf,
    lines: [
      ...recs.map(({ r, s }) => line("recommendation", r.id, s, r.finalQty!)),
      ...exs.map(({ e, s }) => line("exception", e.id, s, e.plannerQty!)),
    ],
  };
}

export interface CreatedPo {
  id: number;
  supplierId: string;
  number: string | null;
  status: string;
  lines: number;
  totalValue: number;
  error?: string;
}

/** Creates one draft PO per supplier. A Zoho failure for one supplier doesn't stop the others. */
export async function createDraftPOs(user: User): Promise<CreatedPo[]> {
  const { lines, dataAsOf } = await readyLines();
  if (!lines.length) throw new Error("No approved lines waiting for a purchase order.");
  const groups = groupByVendor(lines, await vendorMap(), process.env.ZOHO_DEFAULT_VENDOR_ID);
  const db = await getDb();
  const mode = integrationMode("zoho");
  const out: CreatedPo[] = [];
  for (const g of groups) {
    const poLines = g.lines.map((l) => ({ skuId: l.skuId, name: l.name, quantity: l.quantity, rate: l.unitCost ?? 0, source: l.source }));
    const [po] = await db
      .insert(schema.purchaseOrders)
      .values({ vendorId: g.supplierId, mode, status: "pending_push", lines: poLines, totalValue: g.totalValue, dataAsOf, createdBy: user.name })
      .returning({ id: schema.purchaseOrders.id });
    // Claim the lines first so a second click can't put them on another PO.
    const recIds = g.lines.filter((l) => l.source === "recommendation").map((l) => l.id);
    const exIds = g.lines.filter((l) => l.source === "exception").map((l) => l.id);
    if (recIds.length) await db.update(schema.recommendations).set({ purchaseOrderId: po.id }).where(inArray(schema.recommendations.id, recIds));
    if (exIds.length) await db.update(schema.exceptions).set({ purchaseOrderId: po.id }).where(inArray(schema.exceptions.id, exIds));
    try {
      const r = await createDraftPurchaseOrder({
        vendorId: g.zohoVendorId,
        referenceNumber: `FR-PO-${po.id}`,
        date: todayIST(),
        notes: `Draft from Freshroots demand planning. Approved by ${user.name}; data as of ${dataAsOf}.${g.placeholderPrices ? " Rates are placeholder costs." : ""}`,
        lines: g.lines.map((l) => ({ skuId: l.skuId, zohoItemId: l.zohoItemId, name: l.name, quantity: l.quantity, rate: l.unitCost ?? 0 })),
      });
      await db
        .update(schema.purchaseOrders)
        .set({ status: r.status, zohoPurchaseOrderId: r.purchaseOrderId, zohoPurchaseOrderNumber: r.purchaseOrderNumber })
        .where(eq(schema.purchaseOrders.id, po.id));
      out.push({ id: po.id, supplierId: g.supplierId, number: r.purchaseOrderNumber, status: r.status, lines: g.lines.length, totalValue: g.totalValue });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await db.update(schema.purchaseOrders).set({ status: "failed", error: msg }).where(eq(schema.purchaseOrders.id, po.id));
      out.push({ id: po.id, supplierId: g.supplierId, number: null, status: "failed", lines: g.lines.length, totalValue: g.totalValue, error: msg });
    }
  }
  return out;
}

/** Retry a failed push (same PO, same lines). */
export async function retryPurchaseOrder(id: number, user: User) {
  const db = await getDb();
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
  if (!po || po.status !== "failed") throw new Error("Only a failed PO can be retried.");
  const map = await vendorMap();
  const skuRows = await db.select().from(schema.skus);
  const sku = new Map(skuRows.map((s) => [s.skuId, s]));
  const lines = po.lines as { skuId: string; name: string; quantity: number; rate: number }[];
  try {
    const r = await createDraftPurchaseOrder({
      vendorId: map[po.vendorId] || process.env.ZOHO_DEFAULT_VENDOR_ID || po.vendorId,
      referenceNumber: `FR-PO-${po.id}`,
      date: todayIST(),
      notes: `Draft from Freshroots demand planning (retry by ${user.name}); data as of ${po.dataAsOf}.`,
      lines: lines.map((l) => ({ ...l, zohoItemId: sku.get(l.skuId)?.zohoItemId })),
    });
    await db
      .update(schema.purchaseOrders)
      .set({ status: r.status, error: null, mode: r.mode, zohoPurchaseOrderId: r.purchaseOrderId, zohoPurchaseOrderNumber: r.purchaseOrderNumber })
      .where(eq(schema.purchaseOrders.id, id));
  } catch (err) {
    await db.update(schema.purchaseOrders).set({ error: err instanceof Error ? err.message : String(err) }).where(eq(schema.purchaseOrders.id, id));
    throw err;
  }
}

/** Pull each open PO's status from Zoho (procurement confirms there). */
export async function syncStatuses() {
  const db = await getDb();
  const open = await db
    .select()
    .from(schema.purchaseOrders)
    .where(and(sql`${schema.purchaseOrders.zohoPurchaseOrderId} is not null`, sql`${schema.purchaseOrders.status} not in ('failed', 'cancelled', 'billed', 'closed')`));
  let changed = 0;
  for (const po of open) {
    const status = await getPurchaseOrderStatus(po.zohoPurchaseOrderId!);
    if (status !== po.status) {
      await db.update(schema.purchaseOrders).set({ status }).where(eq(schema.purchaseOrders.id, po.id));
      changed++;
    }
  }
  return changed;
}

/** Mock mode only: stand in for procurement confirming the draft inside Zoho. */
export async function confirmMockPurchaseOrder(id: number) {
  const db = await getDb();
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id));
  if (!po?.zohoPurchaseOrderId?.startsWith("mock-")) throw new Error("Only mock POs can be confirmed here — confirm real ones in Zoho.");
  await db
    .update(schema.mockZohoPurchaseOrders)
    .set({ status: "issued" })
    .where(eq(schema.mockZohoPurchaseOrders.id, Number(po.zohoPurchaseOrderId.slice(5))));
  await db.update(schema.purchaseOrders).set({ status: "issued" }).where(eq(schema.purchaseOrders.id, id));
}

export async function purchaseOrders(limit = 30) {
  const db = await getDb();
  return db.select().from(schema.purchaseOrders).orderBy(desc(schema.purchaseOrders.id)).limit(limit);
}

export async function zohoLog(limit = 20) {
  const db = await getDb();
  return db.select().from(schema.zohoApiLog).orderBy(desc(schema.zohoApiLog.id)).limit(limit);
}
