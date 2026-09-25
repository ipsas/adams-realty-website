-- Hand edit: INCLUDE ("list_price") on listings_buy_geo_idx, which drizzle-kit cannot express.
DROP INDEX "listings_geo_idx";--> statement-breakpoint
DROP INDEX "listings_postal_code_idx";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "location_vector" "tsvector" GENERATED ALWAYS AS (
        to_tsvector('simple',
          coalesce("listings"."address_line1", '') || ' ' || coalesce("listings"."city", '') || ' ' ||
          coalesce("listings"."postal_code", '') || ' ' || coalesce("listings"."neighborhood", '') || ' ' ||
          coalesce("listings"."water_body", '') || ' ' || coalesce("listings"."mls_number", ''))) STORED;--> statement-breakpoint
CREATE INDEX "listings_mls_number_idx" ON "listings" USING btree ("mls_number");--> statement-breakpoint
CREATE INDEX "listings_location_idx" ON "listings" USING gin ("location_vector");--> statement-breakpoint
CREATE INDEX "listings_city_trgm_idx" ON "listings" USING gin ("city" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "listings_neighborhood_trgm_idx" ON "listings" USING gin ("neighborhood" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "listings_live_city_trgm_idx" ON "listings" USING gin ("city" gin_trgm_ops) WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_live_neighborhood_trgm_idx" ON "listings" USING gin ("neighborhood" gin_trgm_ops) WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_neighborhood_norm_idx" ON "listings" USING btree (btrim(regexp_replace(lower("neighborhood"), '[^a-z0-9]+', ' ', 'g')));--> statement-breakpoint
CREATE INDEX "listings_water_body_norm_idx" ON "listings" USING btree (btrim(regexp_replace(lower("water_body"), '[^a-z0-9]+', ' ', 'g')));--> statement-breakpoint
CREATE INDEX "listings_city_norm_idx" ON "listings" USING btree (btrim(regexp_replace(lower("city"), '[^a-z0-9]+', ' ', 'g')));--> statement-breakpoint
CREATE INDEX "listings_buy_recommended_idx" ON "listings" USING btree ("is_featured" DESC NULLS FIRST,"list_date" DESC NULLS LAST,"photo_count" DESC NULLS FIRST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_buy_newest_idx" ON "listings" USING btree ("list_date" DESC NULLS LAST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_buy_price_idx" ON "listings" USING btree ("list_price","id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_buy_price_desc_idx" ON "listings" USING btree ("list_price" DESC NULLS FIRST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_buy_sqft_idx" ON "listings" USING btree ("living_area_sqft" DESC NULLS LAST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_buy_ppsf_idx" ON "listings" USING btree (("list_price"::float / nullif("living_area_sqft", 0)) asc nulls last,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_buy_geo_idx" ON "listings" USING btree ("latitude","longitude") INCLUDE ("list_price") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_live_recommended_idx" ON "listings" USING btree ("is_featured" DESC NULLS FIRST,"list_date" DESC NULLS LAST,"photo_count" DESC NULLS FIRST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_live_newest_idx" ON "listings" USING btree ("list_date" DESC NULLS LAST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_live_price_idx" ON "listings" USING btree ("list_price","id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_live_price_desc_idx" ON "listings" USING btree ("list_price" DESC NULLS FIRST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_live_sqft_idx" ON "listings" USING btree ("living_area_sqft" DESC NULLS LAST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_live_ppsf_idx" ON "listings" USING btree (("list_price"::float / nullif("living_area_sqft", 0)) asc nulls last,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_rent_recommended_idx" ON "listings" USING btree ("is_featured" DESC NULLS FIRST,"list_date" DESC NULLS LAST,"photo_count" DESC NULLS FIRST,"id") WHERE "removed_at" is null and "transaction_type" = 'rent' and "status" = 'active';--> statement-breakpoint
CREATE INDEX "listings_sold_recommended_idx" ON "listings" USING btree ("is_featured" DESC NULLS FIRST,"close_date" DESC NULLS LAST,"photo_count" DESC NULLS FIRST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed';--> statement-breakpoint
CREATE INDEX "listings_sold_newest_idx" ON "listings" USING btree ("close_date" DESC NULLS LAST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed';--> statement-breakpoint
CREATE INDEX "listings_postal_code_idx" ON "listings" USING btree ("postal_code" text_pattern_ops);