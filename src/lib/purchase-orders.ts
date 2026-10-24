import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { schema, type Db } from "@/db";
import { daysBetween, todayIst } from "@/lib/dates";
import { zohoAdapter, type PoLineInput } from "@/lib/adapters/zoho";
import { latestRun } from "@/lib/forecast/run";
import { mode } from "@/lib/integrations";
import { notifyProcurement } from "@/lib/notify";
import { getVendorMap } from "@/lib/settings";

/**
 * Approved lines → one DRAFT purchase order per supplier in Zoho (or the mock). Only the latest run's lines are
 * ordered, so an older approval can never double-order a SKU. Procurement confirms the draft inside Zoho.
 */

export interface OrderLine {
  itemId: number; skuId: string; name: string; unit: string; supplierId: string; qty: number; rate: number;
  zohoItemId: string | null; placeholderPrice: boolean;
}

/** Groups lines by supplier and resolves each supplier's Zoho vendor. Pure; exported for tests. */
export function groupBySupplier(lines: OrderLine[], vendorMap: Record<string, string>, defaultVendor: string | undefined, live: boolean) {
  const groups = new Map<string, { supplierId: string; vendorId: string | null; lines: OrderLine[] }>();
  for (const l of lines) {
    const g = groups.get(l.supplierId) ?? groups.set(l.supplierId, {
      supplierId: l.supplierId,
      vendorId: vendorMap[l.supplierId] || defaultVendor || (live ? null : `MOCK-VENDOR-${l.supplierId}`),
      lines: [],
    }).get(l.supplierId)!;
    g.lines.push(l);
  }
  return [...groups.values()];
}

/** Approved, not-yet-ordered lines of the latest run with a quantity above zero. */
export async function linesToOrder(db: Db): Promise<OrderLine[]> {
  const run = await latestRun(db);
  if (!run) return [];
  const rows = await db.select({ item: schema.runItems, sku: schema.skus })
    .from(schema.runItems)
    .innerJoin(schema.skus, eq(schema.skus.id, schema.runItems.skuId))
    .where(and(
      eq(schema.runItems.runId, run.id), inArray(schema.runItems.decision, ["approved", "edited"]),
      gt(schema.runItems.finalQty, 0), isNull(schema.runItems.poId),
    ));
  return rows.map(({ item, sku }) => ({
    itemId: item.id, skuId: sku.id, name: sku.name, unit: sku.unit, supplierId: sku.supplierId ?? "UNASSIGNED",
    qty: item.finalQty!, rate: sku.unitCost ?? 0, zohoItemId: sku.zohoItemId, placeholderPrice: sku.priceSource === "placeholder",
  }));
}

export async function createPurchaseOrders(db: Db, by: string) {
  const run = await latestRun(db);
  const lines = await linesToOrder(db);
  if (!run || !lines.length) return { created: 0, failed: 0, pos: [] as number[] };

  const zoho = zohoAdapter(db);
  const groups = groupBySupplier(lines, await getVendorMap(db), process.env.ZOHO_DEFAULT_VENDOR_ID?.trim(), zoho.mode === "live");
  const dataAgeDays = run.dataThrough ? daysBetween(run.dataThrough, todayIst()) : null;
  const created: number[] = [];
  let failed = 0;

  for (const g of groups) {
    const total = g.lines.reduce((s, l) => s + l.qty * l.rate, 0);
    const [po] = await db.insert(schema.purchaseOrders).values({
      runId: run.id, supplierId: g.supplierId, zohoVendorId: g.vendorId, mode: zoho.mode, status: "creating",
      total, dataAgeDays, createdBy: by,
    }).returning();
    await db.insert(schema.poLines).values(g.lines.map((l) => ({ poId: po.id, runItemId: l.itemId, skuId: l.skuId, qty: l.qty, rate: l.rate })));
    // Claim the lines first so a second click can't order them again.
    await db.update(schema.runItems).set({ poId: po.id }).where(inArray(schema.runItems.id, g.lines.map((l) => l.itemId)));
    const ok = await pushToZoho(db, po.id, g.vendorId, g.lines, run.id, run.dataThrough);
    if (ok) created.push(po.id);
    else failed++;
  }

  if (created.length) await notifyProcurement(db, created);
  return { created: created.length, failed, pos: created };
}

async function pushToZoho(db: Db, poId: number, vendorId: string | null, lines: OrderLine[], runId: number, dataThrough: string | null) {
  const zoho = zohoAdapter(db);
  if (!vendorId) {
    await db.update(schema.purchaseOrders).set({ status: "failed", error: "No Zoho vendor for this supplier: map it below or set ZOHO_DEFAULT_VENDOR_ID." }).where(eq(schema.purchaseOrders.id, poId));
    return false;
  }
  const placeholder = lines.some((l) => l.placeholderPrice);
  try {
    const res = await zoho.createDraftPurchaseOrder({
      vendorId,
      date: todayIst(),
      reference: `FR-RUN${runId}-PO${poId}`,
      notes: `Draft from Freshroots demand planning, run #${runId} (sales data through ${dataThrough}). Approved by the demand planner; procurement to confirm.${placeholder ? " Rates are placeholder costs — check before issuing." : ""}`,
      lines: lines.map<PoLineInput>((l) => ({ skuId: l.skuId, name: l.name, unit: l.unit, qty: l.qty, rate: l.rate, zohoItemId: l.zohoItemId })),
    });
    await db.update(schema.purchaseOrders).set({ status: res.status || "draft", zohoPoId: res.id, zohoPoNumber: res.number, zohoVendorId: vendorId, error: null })
      .where(eq(schema.purchaseOrders.id, poId));
    return true;
  } catch (err) {
    await db.update(schema.purchaseOrders).set({ status: "failed", error: err instanceof Error ? err.message : String(err) }).where(eq(schema.purchaseOrders.id, poId));
    return false;
  }
}

/** Retries a failed PO with the current vendor map. */
export async function retryPurchaseOrder(db: Db, poId: number) {
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId));
  if (!po || po.status !== "failed") throw new Error("Only failed purchase orders can be retried.");
  const [run] = await db.select().from(schema.runs).where(eq(schema.runs.id, po.runId));
  const rows = await db.select({ line: schema.poLines, sku: schema.skus }).from(schema.poLines)
    .innerJoin(schema.skus, eq(schema.skus.id, schema.poLines.skuId)).where(eq(schema.poLines.poId, poId));
  const lines: OrderLine[] = rows.map(({ line, sku }) => ({
    itemId: line.runItemId, skuId: sku.id, name: sku.name, unit: sku.unit, supplierId: po.supplierId, qty: line.qty, rate: line.rate ?? 0,
    zohoItemId: sku.zohoItemId, placeholderPrice: sku.priceSource === "placeholder",
  }));
  const vendorId = (await getVendorMap(db))[po.supplierId] || process.env.ZOHO_DEFAULT_VENDOR_ID?.trim() || (mode("zoho") === "live" ? null : `MOCK-VENDOR-${po.supplierId}`);
  await db.update(schema.purchaseOrders).set({ mode: mode("zoho") }).where(eq(schema.purchaseOrders.id, poId));
  const ok = await pushToZoho(db, poId, vendorId, lines, po.runId, run?.dataThrough ?? null);
  if (ok) await notifyProcurement(db, [poId]);
  return ok;
}

/** Pulls each open draft's status back from Zoho (procurement issues it there). Run by the daily job. */
export async function syncPurchaseOrderStatuses(db: Db) {
  const open = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.status, "draft"));
  const zoho = zohoAdapter(db);
  let changed = 0;
  for (const po of open) {
    if (!po.zohoPoId || po.mode !== zoho.mode) continue;
    try {
      const status = await zoho.getPurchaseOrderStatus(po.zohoPoId);
      if (status && status !== po.status) {
        await db.update(schema.purchaseOrders).set({ status }).where(eq(schema.purchaseOrders.id, po.id));
        changed++;
      }
    } catch {
      // Leave the status as is; the next daily run tries again.
    }
  }
  return changed;
}

/** Mock mode only: stands in for procurement confirming the draft inside Zoho. */
export async function simulateProcurementConfirm(db: Db, poId: number) {
  const [po] = await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, poId));
  if (!po || po.mode !== "mock" || !po.zohoPoId) throw new Error("Only mock purchase orders can be confirmed here.");
  await db.update(schema.mockZohoPurchaseOrders).set({ status: "issued" }).where(eq(schema.mockZohoPurchaseOrders.id, Number(po.zohoPoId.replace("mock-", ""))));
  await db.update(schema.purchaseOrders).set({ status: "issued" }).where(eq(schema.purchaseOrders.id, poId));
}

export async function listPurchaseOrders(db: Db) {
  const pos = await db.select().from(schema.purchaseOrders).orderBy(desc(schema.purchaseOrders.id)).limit(50);
  const lines = pos.length
    ? await db.select({ line: schema.poLines, name: schema.skus.name }).from(schema.poLines)
      .innerJoin(schema.skus, eq(schema.skus.id, schema.poLines.skuId))
      .where(inArray(schema.poLines.poId, pos.map((p) => p.id)))
    : [];
  return pos.map((po) => ({ ...po, lines: lines.filter((l) => l.line.poId === po.id) }));
}
