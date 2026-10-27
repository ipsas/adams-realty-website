CREATE TABLE "sync_quarantine" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"listing_key" text NOT NULL,
	"mls_number" text,
	"modification_timestamp" timestamp with time zone,
	"reason" text NOT NULL,
	"cursor" timestamp with time zone,
	"cursor_key" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "reject_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "reject_streak_cursor" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "reject_streak_cursor_key" text;--> statement-breakpoint
ALTER TABLE "sync_quarantine" ADD CONSTRAINT "sync_quarantine_source_id_data_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sync_quarantine_source_key_idx" ON "sync_quarantine" USING btree ("source_id","listing_key");