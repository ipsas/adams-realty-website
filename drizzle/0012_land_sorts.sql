-- Site review #5 and #8.
--   1. Land sorts: "Acreage (most first)" and "Price per acre", one partial index per
--      search mode, each matching buildOrderBy (src/lib/search/query.ts) exactly.
--   2. Hand edit (drizzle-kit can't express INCLUDE): listings_buy_geo_idx also carries
--      property_type, because the default search now leaves commercial out
--      (`property_type <> 'commercial'`), and viewport and default counts must stay
--      index-only.
DROP INDEX "listings_buy_geo_idx";--> statement-breakpoint
CREATE INDEX "listings_buy_geo_idx" ON "listings" USING btree ("latitude","longitude") INCLUDE ("list_price", "idx_hidden", "property_type") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_buy_lot_idx" ON "listings" USING btree ("lot_size_sqft" DESC NULLS LAST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_buy_ppa_idx" ON "listings" USING btree (("list_price"::float / nullif("lot_size_sqft", 0)) asc nulls last,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE INDEX "listings_live_lot_idx" ON "listings" USING btree ("lot_size_sqft" DESC NULLS LAST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_live_ppa_idx" ON "listings" USING btree (("list_price"::float / nullif("lot_size_sqft", 0)) asc nulls last,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_sold_lot_idx" ON "listings" USING btree ("lot_size_sqft" DESC NULLS LAST,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed';--> statement-breakpoint
CREATE INDEX "listings_sold_ppa_idx" ON "listings" USING btree (("list_price"::float / nullif("lot_size_sqft", 0)) asc nulls last,"id") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed';