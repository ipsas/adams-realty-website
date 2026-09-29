-- The firm hides its own Coming Soon, Withdrawn (On Hold maps here), Expired
-- and Canceled listings from the public too, not only Georgia MLS feed rows:
-- idx_hidden drops its `from_feed and` (docs/plans/gamls-compliance.md,
-- src/lib/listings/visibility.ts). Postgres can't change a generated column's
-- expression while other objects use it, so everything that reads idx_hidden
-- (the two covering indexes and the `places` view, all from 0010) is dropped
-- first and recreated exactly as 0010 made it. Rewrites `listings` once.
--
-- public_since is left alone: rows this hides were public until now, and no
-- row becomes visible, so every visible row keeps its date.
DROP MATERIALIZED VIEW "places";--> statement-breakpoint
DROP INDEX "listings_live_id_idx";--> statement-breakpoint
DROP INDEX "listings_buy_geo_idx";--> statement-breakpoint
ALTER TABLE "listings" DROP COLUMN "idx_hidden";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "idx_hidden" boolean GENERATED ALWAYS AS ("listings"."status" in ('coming_soon', 'withdrawn', 'expired', 'canceled')) STORED NOT NULL;--> statement-breakpoint
CREATE INDEX "listings_live_id_idx" ON "listings" USING btree ("id") INCLUDE ("slug", "updated_at", "idx_hidden") WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
CREATE INDEX "listings_buy_geo_idx" ON "listings" USING btree ("latitude","longitude") INCLUDE ("list_price", "idx_hidden") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
CREATE MATERIALIZED VIEW "places" AS
  SELECT "kind", "label", "sublabel", count(*)::int AS "n" FROM (
    SELECT 'neighborhood'::text AS "kind", "neighborhood" AS "label", "city" AS "sublabel"
      FROM "listings"
      WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending')
        AND NOT "idx_hidden" AND "neighborhood" IS NOT NULL
    UNION ALL
    SELECT 'city', "city", "state"
      FROM "listings"
      WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending')
        AND NOT "idx_hidden"
    UNION ALL
    SELECT 'zip', "postal_code", "city"
      FROM "listings"
      WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending')
        AND NOT "idx_hidden"
  ) s
  GROUP BY "kind", "label", "sublabel";--> statement-breakpoint
CREATE UNIQUE INDEX "places_key_idx" ON "places" ("kind", "label", "sublabel");--> statement-breakpoint
CREATE INDEX "places_label_idx" ON "places" (lower("label") text_pattern_ops);
