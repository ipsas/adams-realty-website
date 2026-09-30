CREATE TABLE "lead_digests" (
	"recipient" text NOT NULL,
	"day" date NOT NULL,
	"items" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_digests_recipient_day_pk" PRIMARY KEY("recipient","day")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lead_copies" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "lead_digest" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "first_contacted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "inquiries" ADD COLUMN "follow_up_on" date;--> statement-breakpoint
CREATE INDEX "inquiries_follow_up_idx" ON "inquiries" USING btree ("follow_up_on");