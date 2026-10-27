ALTER TABLE "email_outbox" ADD COLUMN "first_tried_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_outbox" ADD COLUMN "payload" jsonb;