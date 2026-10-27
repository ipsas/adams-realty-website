ALTER TABLE "listings" ADD COLUMN "main_level_bedrooms" integer;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "primary_bedroom_on_main" boolean;--> statement-breakpoint
CREATE INDEX "listings_main_level_bedrooms_idx" ON "listings" USING btree ("main_level_bedrooms");--> statement-breakpoint
CREATE INDEX "listings_primary_on_main_idx" ON "listings" USING btree ("id") WHERE "listings"."primary_bedroom_on_main" = true;--> statement-breakpoint
UPDATE "listings" SET "primary_bedroom_on_main" = true WHERE "primary_bedroom_on_main" IS NULL AND "features"->'interior' ? 'Master On Main Level';
