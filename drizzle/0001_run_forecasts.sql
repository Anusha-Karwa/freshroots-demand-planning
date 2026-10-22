CREATE TABLE "run_forecasts" (
	"run_id" integer NOT NULL,
	"sku_id" text NOT NULL,
	"planning_week" date NOT NULL,
	"expected_weekly" numeric(14, 3) NOT NULL,
	"stock_on_hand" numeric(14, 3) NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "run_forecasts_run_id_sku_id_pk" PRIMARY KEY("run_id","sku_id")
);
--> statement-breakpoint
CREATE INDEX "run_forecasts_week_idx" ON "run_forecasts" USING btree ("planning_week");