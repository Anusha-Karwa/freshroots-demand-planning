CREATE TABLE "uploads" (
	"token" text PRIMARY KEY NOT NULL,
	"file_type" text NOT NULL,
	"file_name" text NOT NULL,
	"content" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"report" jsonb
);
