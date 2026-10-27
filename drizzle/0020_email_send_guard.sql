CREATE TABLE "app_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"set_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_send_counters" (
	"period" text PRIMARY KEY NOT NULL,
	"batch" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
