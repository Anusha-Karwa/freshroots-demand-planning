import {
  pgTable, text, integer, serial, boolean, numeric, date, timestamp, jsonb, primaryKey, index,
} from "drizzle-orm/pg-core";
import type { RulesConfig } from "@/lib/rules/config";
import type { ItemMetrics } from "@/lib/rules/engine";

// Numeric columns come back as strings from Postgres; mode "number" converts them for us.
const qty = (name: string) => numeric(name, { mode: "number" });
const createdAt = () => timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// ---------- Master data (from SAP / seed files) ----------

export const skus = pgTable("skus", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  perishable: boolean("perishable").notNull(),
  standardOrderQty: qty("standard_order_qty").notNull(),
  unit: text("unit").default("Units").notNull(),
  // The SKU file's Distributor_ID column is the supplier the SKU is bought from.
  supplierId: text("supplier_id"),
  unitCost: qty("unit_cost"),
  unitPrice: qty("unit_price"),
  // "placeholder" until real cost/price columns are loaded; every ₹ figure built on it says "estimated".
  priceSource: text("price_source").default("placeholder").notNull(),
  zohoItemId: text("zoho_item_id"),
  active: boolean("active").default(true).notNull(),
});

export const distributors = pgTable("distributors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  region: text("region"),
  status: text("status"),
});

/** One row per month. Festival months for the rules live in the rules config; this is the context calendar. */
export const calendarMonths = pgTable("calendar_months", {
  yearMonth: text("year_month").primaryKey(), // "2026-10"
  isFestival: boolean("is_festival").default(false).notNull(),
  festivalName: text("festival_name"),
  competitorScheme: text("competitor_scheme"),
});

/** Demand context the planner adds by hand: competitor schemes, one-off events. Gemini sees them. */
export const marketEvents = pgTable("market_events", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(), // competitor_scheme | festival | other
  description: text("description").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  skuId: text("sku_id"), // null = applies to all SKUs (or a category)
  category: text("category"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

// ---------- Transactions ----------

/** Weekly units by SKU × distributor. weekStart is the Monday. distributorId "ALL" = SKU-level total only. */
export const weeklySales = pgTable("weekly_sales", {
  weekStart: date("week_start").notNull(),
  skuId: text("sku_id").notNull(),
  distributorId: text("distributor_id").notNull(),
  units: qty("units").notNull(),
}, (t) => [primaryKey({ columns: [t.weekStart, t.skuId, t.distributorId] }), index("weekly_sales_sku").on(t.skuId)]);

export const stockSnapshots = pgTable("stock_snapshots", {
  asOf: date("as_of").notNull(),
  skuId: text("sku_id").notNull(),
  location: text("location").notNull(),
  units: qty("units").notNull(),
}, (t) => [primaryKey({ columns: [t.asOf, t.skuId, t.location] })]);

// ---------- Rules config & settings ----------

/** Every change to Raghav's rules is a new row; the latest row is in force. */
export const rulesVersions = pgTable("rules_versions", {
  id: serial("id").primaryKey(),
  config: jsonb("config").$type<RulesConfig>().notNull(),
  note: text("note"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

/** Key/value settings: baseline, kill-switch thresholds, supplier → Zoho vendor map. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: text("updated_by"),
  updatedAt: createdAt(),
});

// ---------- Forecast runs ----------

export const runs = pgTable("runs", {
  id: serial("id").primaryKey(),
  trigger: text("trigger").notNull(), // cron | manual | script
  status: text("status").notNull(), // running | done | failed
  startedAt: createdAt(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  planningDate: date("planning_date").notNull(),
  dataThrough: date("data_through"), // last day covered by sales data
  stockAsOf: date("stock_as_of"),
  rulesVersionId: integer("rules_version_id"),
  reasonSource: text("reason_source"), // gemini | template
  summary: jsonb("summary").$type<Record<string, number>>(),
  error: text("error"),
});

/** One row per SKU per run, flagged or not (the unflagged rows give the tracker its forecast). */
export const runItems = pgTable("run_items", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  skuId: text("sku_id").notNull(),
  queue: text("queue").notNull(), // none | review | exception
  flags: jsonb("flags").$type<string[]>().notNull(),
  exceptions: jsonb("exceptions").$type<string[]>().notNull(),
  metrics: jsonb("metrics").$type<ItemMetrics>().notNull(),
  forecastWeekly: qty("forecast_weekly").notNull(),
  // What the rules suggest. null for exceptions (Raghav sets the quantity).
  recommendedQty: qty("recommended_qty"),
  action: text("action"), // reorder_now | reorder | pause | judgement
  reason: text("reason"),
  reasonSource: text("reason_source"),
  aiNote: text("ai_note"), // why Gemini thinks this looks unusual
  // Raghav's final call
  decision: text("decision").default("pending").notNull(), // pending | approved | edited | rejected
  finalQty: qty("final_qty"),
  decisionReason: text("decision_reason"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  poId: integer("po_id"),
}, (t) => [index("run_items_run").on(t.runId)]);

/** Append-only log of every decision, including changes of mind. */
export const decisionLog = pgTable("decision_log", {
  id: serial("id").primaryKey(),
  runItemId: integer("run_item_id").notNull(),
  runId: integer("run_id").notNull(),
  skuId: text("sku_id").notNull(),
  decision: text("decision").notNull(),
  recommendedQty: qty("recommended_qty"),
  finalQty: qty("final_qty"),
  reason: text("reason"),
  decidedBy: text("decided_by").notNull(),
  dataAgeDays: integer("data_age_days"),
  createdAt: createdAt(),
});

// ---------- Purchase orders ----------

export const purchaseOrders = pgTable("purchase_orders", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  supplierId: text("supplier_id").notNull(),
  zohoVendorId: text("zoho_vendor_id"),
  mode: text("mode").notNull(), // live | mock
  status: text("status").notNull(), // draft | failed | issued | billed | closed | cancelled
  zohoPoId: text("zoho_po_id"),
  zohoPoNumber: text("zoho_po_number"),
  total: qty("total"),
  dataAgeDays: integer("data_age_days"),
  error: text("error"),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const poLines = pgTable("po_lines", {
  id: serial("id").primaryKey(),
  poId: integer("po_id").notNull(),
  runItemId: integer("run_item_id").notNull(),
  skuId: text("sku_id").notNull(),
  qty: qty("qty").notNull(),
  rate: qty("rate"),
});

/** Stand-in for Zoho when its keys are missing. */
export const mockZohoPurchaseOrders = pgTable("mock_zoho_purchase_orders", {
  id: serial("id").primaryKey(),
  poNumber: text("po_number").notNull(),
  status: text("status").default("draft").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: createdAt(),
});

export const zohoApiLog = pgTable("zoho_api_log", {
  id: serial("id").primaryKey(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  status: integer("status"),
  summary: text("summary"),
  createdAt: createdAt(),
});

// ---------- Emails ----------

/** Stand-in for Resend when its key is missing. */
export const mockEmails = pgTable("mock_emails", {
  id: serial("id").primaryKey(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export const emailLog = pgTable("email_log", {
  id: serial("id").primaryKey(),
  mode: text("mode").notNull(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  status: text("status").notNull(), // sent | failed | skipped
  detail: text("detail"),
  createdAt: createdAt(),
});

// ---------- Measurement ----------

/** Daily early-warning: latest week's actual units vs the forecast a run made for it. */
export const trackerChecks = pgTable("tracker_checks", {
  checkDate: date("check_date").notNull(),
  skuId: text("sku_id").notNull(),
  weekStart: date("week_start").notNull(),
  actualUnits: qty("actual_units").notNull(),
  forecastUnits: qty("forecast_units").notNull(),
  variancePct: qty("variance_pct"),
  stockUnits: qty("stock_units"),
  weeksCover: qty("weeks_cover"),
  status: text("status").notNull(), // on_track | above | below | stockout
}, (t) => [primaryKey({ columns: [t.checkDate, t.skuId] })]);

export const stockoutIncidents = pgTable("stockout_incidents", {
  id: serial("id").primaryKey(),
  skuId: text("sku_id").notNull(),
  weekStart: date("week_start").notNull(),
  source: text("source").notNull(), // auto | manual
  lostUnits: qty("lost_units"),
  lostValue: qty("lost_value"),
  note: text("note"),
  createdAt: createdAt(),
});

/** The primary outcome metric, entered monthly from finance's numbers. */
export const monthlyLosses = pgTable("monthly_losses", {
  yearMonth: text("year_month").primaryKey(),
  stockoutLoss: qty("stockout_loss").notNull(),
  overstockWriteoff: qty("overstock_writeoff").notNull(),
  distributorComplaints: integer("distributor_complaints"),
  note: text("note"),
  enteredBy: text("entered_by").notNull(),
  updatedAt: createdAt(),
});

export const killSwitchHistory = pgTable("kill_switch_history", {
  checkDate: date("check_date").primaryKey(),
  overall: text("overall").notNull(),
  early: text("early").notNull(),
  outcome: text("outcome").notNull(),
  detail: jsonb("detail"),
});

// ---------- Data loading ----------

/** SAP CSVs wait here between upload and the column-mapping step (serverless instances share nothing else). */
export const uploads = pgTable("uploads", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  filename: text("filename").notNull(),
  content: text("content").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

export const dataLoads = pgTable("data_loads", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // seed | sap_upload
  kind: text("kind").notNull(),
  filename: text("filename"),
  accepted: integer("accepted").notNull(),
  rejected: integer("rejected").notNull(),
  summary: jsonb("summary"),
  loadedBy: text("loaded_by").notNull(),
  createdAt: createdAt(),
});

/** Optional: Raghav's past manual flags, for the backtest's agreement score. */
export const plannerHistory = pgTable("planner_history", {
  weekStart: date("week_start").notNull(),
  skuId: text("sku_id").notNull(),
  flag: text("flag").notNull(), // HIGH_DEMAND | STOCKOUT_RISK | OVERSTOCK_RISK | NONE
}, (t) => [primaryKey({ columns: [t.weekStart, t.skuId, t.flag] })]);
