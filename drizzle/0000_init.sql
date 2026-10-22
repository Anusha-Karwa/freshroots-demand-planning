CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text
);
--> statement-breakpoint
CREATE TABLE "calendar_weeks" (
	"week_start" date PRIMARY KEY NOT NULL,
	"month" integer NOT NULL,
	"year" integer NOT NULL,
	"is_festival" boolean DEFAULT false NOT NULL,
	"festival_name" text,
	"competitor_scheme" text,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "daily_tracker" (
	"date" date NOT NULL,
	"sku_id" text NOT NULL,
	"forecast_units" numeric(14, 2) NOT NULL,
	"actual_units" numeric(14, 2) NOT NULL,
	"stock_on_hand" numeric(14, 3),
	"deviation_pct" numeric(8, 2),
	CONSTRAINT "daily_tracker_date_sku_id_pk" PRIMARY KEY("date","sku_id")
);
--> statement-breakpoint
CREATE TABLE "data_loads" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"file_type" text NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"data_as_of" date,
	"rows_accepted" integer DEFAULT 0 NOT NULL,
	"rows_rejected" integer DEFAULT 0 NOT NULL,
	"summary" jsonb
);
--> statement-breakpoint
CREATE TABLE "distributor_complaints" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"distributor_id" text,
	"sku_id" text,
	"note" text NOT NULL,
	"entered_by" text
);
--> statement-breakpoint
CREATE TABLE "distributors" (
	"distributor_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"district" text,
	"region" text,
	"state" text,
	"active" boolean DEFAULT true NOT NULL,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "exceptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"types" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"ai_note" text,
	"ai_note_source" text,
	"status" text DEFAULT 'open' NOT NULL,
	"planner_qty" integer,
	"planner_note" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"purchase_order_id" integer
);
--> statement-breakpoint
CREATE TABLE "forecast_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text DEFAULT 'running' NOT NULL,
	"data_as_of" date,
	"rules_version" integer,
	"counts" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "inventory_snapshots" (
	"snapshot_date" date NOT NULL,
	"sku_id" text NOT NULL,
	"location" text DEFAULT 'ALL' NOT NULL,
	"stock_on_hand" numeric(14, 3) NOT NULL,
	"load_id" integer,
	CONSTRAINT "inventory_snapshots_snapshot_date_sku_id_location_pk" PRIMARY KEY("snapshot_date","sku_id","location")
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
	"purchaseorder_number" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "monthly_losses" (
	"month" text PRIMARY KEY NOT NULL,
	"stockout_loss" numeric(14, 2) NOT NULL,
	"overstock_writeoff" numeric(14, 2) NOT NULL,
	"notes" text,
	"entered_by" text,
	"entered_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"vendor_id" text NOT NULL,
	"mode" text NOT NULL,
	"status" text DEFAULT 'pending_push' NOT NULL,
	"zoho_purchaseorder_id" text,
	"zoho_purchaseorder_number" text,
	"lines" jsonb NOT NULL,
	"total_value" numeric(14, 2),
	"data_as_of" date,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"flags" jsonb NOT NULL,
	"primary_flag" text NOT NULL,
	"metrics" jsonb NOT NULL,
	"action" text NOT NULL,
	"recommended_qty" integer NOT NULL,
	"reason" text,
	"reason_source" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"final_qty" integer,
	"decision_reason" text,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"purchase_order_id" integer
);
--> statement-breakpoint
CREATE TABLE "rejected_rows" (
	"id" serial PRIMARY KEY NOT NULL,
	"load_id" integer NOT NULL,
	"row_number" integer NOT NULL,
	"reason" text NOT NULL,
	"raw" jsonb
);
--> statement-breakpoint
CREATE TABLE "rules_config_versions" (
	"version" serial PRIMARY KEY NOT NULL,
	"config" jsonb NOT NULL,
	"changed_by" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "sku_weekly_sales" (
	"week_start" date NOT NULL,
	"sku_id" text NOT NULL,
	"units" numeric(16, 3) NOT NULL,
	"distributor_count" integer NOT NULL,
	CONSTRAINT "sku_weekly_sales_sku_id_week_start_pk" PRIMARY KEY("sku_id","week_start")
);
--> statement-breakpoint
CREATE TABLE "skus" (
	"sku_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text,
	"is_perishable" boolean NOT NULL,
	"standard_order_qty" integer NOT NULL,
	"unit_cost" numeric(12, 2),
	"unit_price" numeric(12, 2),
	"vendor_id" text,
	"zoho_item_id" text,
	"launch_date" date,
	"active" boolean DEFAULT true NOT NULL,
	"extra" jsonb
);
--> statement-breakpoint
CREATE TABLE "stockout_incidents" (
	"id" serial PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"sku_id" text NOT NULL,
	"distributor_id" text,
	"est_lost_units" integer,
	"est_lost_value" numeric(14, 2),
	"source" text NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "weekly_sales" (
	"week_start" date NOT NULL,
	"sku_id" text NOT NULL,
	"distributor_id" text NOT NULL,
	"units" numeric(14, 3) NOT NULL,
	"value" numeric(14, 2),
	"load_id" integer,
	CONSTRAINT "weekly_sales_week_start_sku_id_distributor_id_pk" PRIMARY KEY("week_start","sku_id","distributor_id")
);
--> statement-breakpoint
CREATE TABLE "zoho_api_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"mode" text NOT NULL,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status_code" integer,
	"request_summary" text,
	"response_summary" text
);
--> statement-breakpoint
ALTER TABLE "inventory_snapshots" ADD CONSTRAINT "inventory_snapshots_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_sales" ADD CONSTRAINT "weekly_sales_sku_id_skus_sku_id_fk" FOREIGN KEY ("sku_id") REFERENCES "public"."skus"("sku_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_sales" ADD CONSTRAINT "weekly_sales_distributor_id_distributors_distributor_id_fk" FOREIGN KEY ("distributor_id") REFERENCES "public"."distributors"("distributor_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "recommendations_run_sku" ON "recommendations" USING btree ("run_id","sku_id");--> statement-breakpoint
CREATE INDEX "weekly_sales_sku_idx" ON "weekly_sales" USING btree ("sku_id","week_start");