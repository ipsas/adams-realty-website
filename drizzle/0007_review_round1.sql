ALTER TYPE "public"."sync_status" ADD VALUE 'skipped';--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "sync_cursor_key" text;--> statement-breakpoint
CREATE INDEX "listings_live_location_idx" ON "listings" USING gin ("location_vector") WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_live_address_trgm_idx" ON "listings" USING gin ("address_line1" gin_trgm_ops) WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_sold_location_idx" ON "listings" USING gin ("location_vector") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed';--> statement-breakpoint
CREATE INDEX "listings_sold_city_trgm_idx" ON "listings" USING gin ("city" gin_trgm_ops) WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed';--> statement-breakpoint
CREATE INDEX "listings_sold_neighborhood_trgm_idx" ON "listings" USING gin ("neighborhood" gin_trgm_ops) WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed';--> statement-breakpoint
CREATE INDEX "listings_sold_address_trgm_idx" ON "listings" USING gin ("address_line1" gin_trgm_ops) WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed';