import {
  pgTable,
  text,
  integer,
  boolean,
  date,
  timestamp,
  numeric,
  serial,
  jsonb,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Master data (from the 5 seed files / SAP export)
// ---------------------------------------------------------------------------

export const skus = pgTable("skus", {
  skuId: text("sku_id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  isPerishable: boolean("is_perishable").notNull(),
  standardOrderQty: integer("standard_order_qty").notNull(),
  unitCost: numeric("unit_cost", { precision: 12, scale: 2, mode: "number" }),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2, mode: "number" }),
  vendorId: text("vendor_id"),
  zohoItemId: text("zoho_item_id"),
  launchDate: date("launch_date"),
  active: boolean("active").notNull().default(true),
  extra: jsonb("extra").$type<Record<string, string>>(), // unmapped seed columns, kept for reference
});

export const distributors = pgTable("distributors", {
  distributorId: text("distributor_id").primaryKey(),
  name: text("name").notNull(),
  district: text("district"),
  region: text("region"),
  state: text("state"),
  active: boolean("active").notNull().default(true),
  extra: jsonb("extra").$type<Record<string, string>>(),
});

/** One row per week. week_start is the Monday of the week (ISO). */
export const calendarWeeks = pgTable("calendar_weeks", {
  weekStart: date("week_start").primaryKey(),
  month: integer("month").notNull(), // 1–12, month the week is attributed to
  year: integer("year").notNull(),
  isFestival: boolean("is_festival").notNull().default(false),
  festivalName: text("festival_name"),
  competitorScheme: text("competitor_scheme"), // free text, e.g. "Brand X 10% off atta"
  extra: jsonb("extra").$type<Record<string, string>>(),
});

/** Weekly sell-in by SKU × distributor. */
export const weeklySales = pgTable(
  "weekly_sales",
  {
    weekStart: date("week_start").notNull(),
    skuId: text("sku_id").notNull().references(() => skus.skuId),
    distributorId: text("distributor_id").notNull().references(() => distributors.distributorId),
    units: numeric("units", { precision: 14, scale: 3, mode: "number" }).notNull(),
    value: numeric("value", { precision: 14, scale: 2, mode: "number" }),
    loadId: integer("load_id"),
  },
  (t) => [
    primaryKey({ columns: [t.weekStart, t.skuId, t.distributorId] }),
    index("weekly_sales_sku_idx").on(t.skuId, t.weekStart),
  ],
);

/** SKU-level weekly totals, rebuilt after every load. The rules engine reads this. */
export const skuWeeklySales = pgTable(
  "sku_weekly_sales",
  {
    weekStart: date("week_start").notNull(),
    skuId: text("sku_id").notNull(),
    units: numeric("units", { precision: 16, scale: 3, mode: "number" }).notNull(),
    distributorCount: integer("distributor_count").notNull(),
  },
  (t) => [primaryKey({ columns: [t.skuId, t.weekStart] })],
);

/** Stock on hand per SKU at a point in time. */
export const inventorySnapshots = pgTable(
  "inventory_snapshots",
  {
    snapshotDate: date("snapshot_date").notNull(),
    skuId: text("sku_id").notNull().references(() => skus.skuId),
    location: text("location").notNull().default("ALL"),
    stockOnHand: numeric("stock_on_hand", { precision: 14, scale: 3, mode: "number" }).notNull(),
    loadId: integer("load_id"),
  },
  (t) => [primaryKey({ columns: [t.snapshotDate, t.skuId, t.location] })],
);

/** Every file load (seed or SAP CSV upload), with what was accepted and rejected. */
export const dataLoads = pgTable("data_loads", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // 'seed' | 'sap_csv'
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(), // calendar | skus | distributors | inventory | weekly_sales
  loadedAt: timestamp("loaded_at", { withTimezone: true }).notNull().defaultNow(),
  dataAsOf: date("data_as_of"),
  rowsAccepted: integer("rows_accepted").notNull().default(0),
  rowsRejected: integer("rows_rejected").notNull().default(0),
  summary: jsonb("summary"),
});

export const rejectedRows = pgTable("rejected_rows", {
  id: serial("id").primaryKey(),
  loadId: integer("load_id").notNull(),
  rowNumber: integer("row_number").notNull(),
  reason: text("reason").notNull(),
  raw: jsonb("raw"),
});

// ---------------------------------------------------------------------------
// Rules, runs and decisions
// ---------------------------------------------------------------------------

/** Versioned rules config. The active config is the row with the highest version. */
export const rulesConfigVersions = pgTable("rules_config_versions", {
  version: serial("version").primaryKey(),
  config: jsonb("config").notNull(),
  changedBy: text("changed_by").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

export const forecastRuns = pgTable("forecast_runs", {
  id: serial("id").primaryKey(),
  trigger: text("trigger").notNull(), // 'cron' | 'manual'
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull().default("running"), // running | done | failed
  dataAsOf: date("data_as_of"),
  rulesVersion: integer("rules_version"),
  counts: jsonb("counts"),
  error: text("error"),
});

/** One flagged SKU per run. Rules set the quantity; the AI only writes `reason`. */
export const recommendations = pgTable(
  "recommendations",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").notNull(),
    skuId: text("sku_id").notNull(),
    flags: jsonb("flags").$type<string[]>().notNull(), // HIGH_DEMAND, STOCKOUT_RISK, OVERSTOCK_RISK
    primaryFlag: text("primary_flag").notNull(),
    metrics: jsonb("metrics").notNull(), // every number behind the recommendation
    action: text("action").notNull(), // REORDER | REORDER_NOW | PAUSE_NEXT_ORDER
    recommendedQty: integer("recommended_qty").notNull(),
    reason: text("reason"),
    reasonSource: text("reason_source"), // 'gemini' | 'template'
    status: text("status").notNull().default("pending"), // pending | approved | edited | rejected
    finalQty: integer("final_qty"),
    decisionReason: text("decision_reason"),
    decidedBy: text("decided_by"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    purchaseOrderId: integer("purchase_order_id"),
  },
  (t) => [uniqueIndex("recommendations_run_sku").on(t.runId, t.skuId)],
);

/** Cases the rules can't decide — Raghav's judgement queue. */
export const exceptions = pgTable("exceptions", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  skuId: text("sku_id").notNull(),
  types: jsonb("types").$type<string[]>().notNull(), // NEW_SKU | DISTRIBUTOR_CONCENTRATION | WOW_SWING
  metrics: jsonb("metrics").notNull(),
  aiNote: text("ai_note"),
  aiNoteSource: text("ai_note_source"),
  status: text("status").notNull().default("open"), // open | ordered | no_action
  plannerQty: integer("planner_qty"),
  plannerNote: text("planner_note"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  purchaseOrderId: integer("purchase_order_id"),
});

// ---------------------------------------------------------------------------
// Purchase orders (Zoho live or mock)
// ---------------------------------------------------------------------------

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  vendorId: text("vendor_id").notNull(),
  mode: text("mode").notNull(), // 'live' | 'mock'
  status: text("status").notNull().default("pending_push"), // pending_push | draft | failed | confirmed
  zohoPurchaseOrderId: text("zoho_purchaseorder_id"),
  zohoPurchaseOrderNumber: text("zoho_purchaseorder_number"),
  lines: jsonb("lines").notNull(),
  totalValue: numeric("total_value", { precision: 14, scale: 2, mode: "number" }),
  dataAsOf: date("data_as_of"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  error: text("error"),
});

export const mockZohoPurchaseOrders = pgTable("mock_zoho_purchase_orders", {
  id: serial("id").primaryKey(),
  purchaseOrderNumber: text("purchaseorder_number").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const zohoApiLog = pgTable("zoho_api_log", {
  id: serial("id").primaryKey(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  mode: text("mode").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  statusCode: integer("status_code"),
  requestSummary: text("request_summary"),
  responseSummary: text("response_summary"),
});

export const mockEmails = pgTable("mock_emails", {
  id: serial("id").primaryKey(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Measurement: tracker, losses, kill switch
// ---------------------------------------------------------------------------

/** Daily early-warning: actual stock depletion vs forecast, per SKU. */
export const dailyTracker = pgTable(
  "daily_tracker",
  {
    date: date("date").notNull(),
    skuId: text("sku_id").notNull(),
    forecastUnits: numeric("forecast_units", { precision: 14, scale: 2, mode: "number" }).notNull(),
    actualUnits: numeric("actual_units", { precision: 14, scale: 2, mode: "number" }).notNull(),
    stockOnHand: numeric("stock_on_hand", { precision: 14, scale: 3, mode: "number" }),
    deviationPct: numeric("deviation_pct", { precision: 8, scale: 2, mode: "number" }),
  },
  (t) => [primaryKey({ columns: [t.date, t.skuId] })],
);

export const stockoutIncidents = pgTable("stockout_incidents", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  skuId: text("sku_id").notNull(),
  distributorId: text("distributor_id"),
  estLostUnits: integer("est_lost_units"),
  estLostValue: numeric("est_lost_value", { precision: 14, scale: 2, mode: "number" }),
  source: text("source").notNull(), // 'detected' | 'manual'
  note: text("note"),
});

/** Primary outcome metric: ₹ losses per month (manual entry is fine for MVP). */
export const monthlyLosses = pgTable("monthly_losses", {
  month: text("month").primaryKey(), // YYYY-MM
  stockoutLoss: numeric("stockout_loss", { precision: 14, scale: 2, mode: "number" }).notNull(),
  overstockWriteoff: numeric("overstock_writeoff", { precision: 14, scale: 2, mode: "number" }).notNull(),
  notes: text("notes"),
  enteredBy: text("entered_by"),
  enteredAt: timestamp("entered_at", { withTimezone: true }).notNull().defaultNow(),
});

export const distributorComplaints = pgTable("distributor_complaints", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  distributorId: text("distributor_id"),
  skuId: text("sku_id"),
  note: text("note").notNull(),
  enteredBy: text("entered_by"),
});

/** Key-value settings: baseline numbers, build cost, etc. Editable, not hard-coded. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: text("updated_by"),
});
