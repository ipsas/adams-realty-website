ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "main_level_bedrooms" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN IF NOT EXISTS "primary_bedroom_on_main" boolean;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_main_level_bedrooms_idx" ON "listings" USING btree ("main_level_bedrooms");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "listings_primary_on_main_idx" ON "listings" USING btree ("id") WHERE "listings"."primary_bedroom_on_main" = true;