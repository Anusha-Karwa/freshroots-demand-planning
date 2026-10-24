CREATE TABLE "calendar_months" (
	"year_month" text PRIMARY KEY NOT NULL,
	"is_festival" boolean DEFAULT false NOT NULL,
	"festival_name" text,
	"competitor_scheme" text
);
--> statement-breakpoint
CREATE TABLE "data_loads" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"filename" text,
	"accepted" integer NOT NULL,
	"rejected" integer NOT NULL,
	"summary" jsonb,
	"loaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_item_id" integer NOT NULL,
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"decision" text NOT NULL,
	"recommended_qty" numeric,
	"final_qty" numeric,
	"reason" text,
	"decided_by" text NOT NULL,
	"data_age_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "distributors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"region" text,
	"status" text
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"mode" text NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"status" text NOT NULL,
	"detail" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kill_switch_history" (
	"check_date" date PRIMARY KEY NOT NULL,
	"overall" text NOT NULL,
	"early" text NOT NULL,
	"outcome" text NOT NULL,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "market_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"sku_id" text,
	"category" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_emails" (
	"id" serial PRIMARY KEY NOT NULL,
	"to" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_zoho_purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_number" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_losses" (
	"year_month" text PRIMARY KEY NOT NULL,
	"stockout_loss" numeric NOT NULL,
	"overstock_writeoff" numeric NOT NULL,
	"distributor_complaints" integer,
	"note" text,
	"entered_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "planner_history" (
	"week_start" date NOT NULL,
	"sku_id" text NOT NULL,
	"flag" text NOT NULL,
	CONSTRAINT "planner_history_week_start_sku_id_flag_pk" PRIMARY KEY("week_start","sku_id","flag")
);
--> statement-breakpoint
CREATE TABLE "po_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"po_id" integer NOT NULL,
	"run_item_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"qty" numeric NOT NULL,
	"rate" numeric
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"supplier_id" text NOT NULL,
	"zoho_vendor_id" text,
	"mode" text NOT NULL,
	"status" text NOT NULL,
	"zoho_po_id" text,
	"zoho_po_number" text,
	"total" numeric,
	"data_age_days" integer,
	"error" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rules_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"note" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"queue" text NOT NULL,
	"flags" jsonb NOT NULL,
	"exceptions" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"forecast_weekly" numeric NOT NULL,
	"recommended_qty" numeric,
	"action" text,
	"reason" text,
	"reason_source" text,
	"ai_note" text,
	"decision" text DEFAULT 'pending' NOT NULL,
	"final_qty" numeric,
	"decision_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"po_id" integer
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"planning_date" date NOT NULL,
	"data_through" date,
	"stock_as_of" date,
	"rules_version_id" integer,
	"reason_source" text,
	"summary" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"perishable" boolean NOT NULL,
	"standard_order_qty" numeric NOT NULL,
	"unit" text DEFAULT 'Units' NOT NULL,
	"supplier_id" text,
	"unit_cost" numeric,
	"unit_price" numeric,
	"price_source" text DEFAULT 'placeholder' NOT NULL,
	"zoho_item_id" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_snapshots" (
	"as_of" date NOT NULL,
	"sku_id" text NOT NULL,
	"location" text NOT NULL,
	"units" numeric NOT NULL,
	CONSTRAINT "stock_snapshots_as_of_sku_id_location_pk" PRIMARY KEY("as_of","sku_id","location")
);
--> statement-breakpoint
CREATE TABLE "stockout_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"sku_id" text NOT NULL,
	"week_start" date NOT NULL,
	"source" text NOT NULL,
	"lost_units" numeric,
	"lost_value" numeric,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracker_checks" (
	"check_date" date NOT NULL,
	"sku_id" text NOT NULL,
	"week_start" date NOT NULL,
	"actual_units" numeric NOT NULL,
	"forecast_units" numeric NOT NULL,
	"variance_pct" numeric,
	"stock_units" numeric,
	"weeks_cover" numeric,
	"status" text NOT NULL,
	CONSTRAINT "tracker_checks_check_date_sku_id_pk" PRIMARY KEY("check_date","sku_id")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"filename" text NOT NULL,
	"content" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_sales" (
	"week_start" date NOT NULL,
	"sku_id" text NOT NULL,
	"distributor_id" text NOT NULL,
	"units" numeric NOT NULL,
	CONSTRAINT "weekly_sales_week_start_sku_id_distributor_id_pk" PRIMARY KEY("week_start","sku_id","distributor_id")
);
--> statement-breakpoint
CREATE TABLE "zoho_api_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" integer,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "run_items_run" ON "run_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "weekly_sales_sku" ON "weekly_sales" USING btree ("sku_id");