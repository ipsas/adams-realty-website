-- Georgia MLS IDX compliance: hidden statuses, attribution fields, page views, rate limits.
CREATE TABLE "listing_views" (
	"listing_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "listing_views_listing_id_day_pk" PRIMARY KEY("listing_id","day")
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "attribution_phone" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "attribution_email" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "variable_compensation" boolean;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "buyer_agency_compensation" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "compensation_comments" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "from_feed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "idx_hidden" boolean GENERATED ALWAYS AS ("listings"."from_feed" and "listings"."status" in ('coming_soon', 'withdrawn', 'expired', 'canceled')) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "public_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "listing_views" ADD CONSTRAINT "listing_views_listing_id_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."listings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "listing_views_day_idx" ON "listing_views" USING btree ("day");--> statement-breakpoint
-- Hand edits below (drizzle-kit can't express them). Georgia MLS IDX display
-- rules: docs/plans/gamls-compliance.md and src/lib/listings/visibility.ts.
--
-- 1. Rows from an MLS feed are marked, which also computes idx_hidden.
UPDATE "listings" SET "from_feed" = true
WHERE "source_id" IN (SELECT "id" FROM "data_sources" WHERE "kind" <> 'manual');--> statement-breakpoint
-- 2. Listings visible today have been public since they were first recorded.
UPDATE "listings" SET "public_since" = "created_at" WHERE NOT "idx_hidden";--> statement-breakpoint
-- 3. Counters are disposable: no WAL for them.
ALTER TABLE "rate_limits" SET UNLOGGED;--> statement-breakpoint
-- 4. The two covering indexes stay index-only now that their queries also
--    test idx_hidden (sitemap chunks; map viewport counts).
DROP INDEX "listings_live_id_idx";--> statement-breakpoint
CREATE INDEX "listings_live_id_idx" ON "listings" USING btree ("id") INCLUDE ("slug", "updated_at", "idx_hidden") WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
DROP INDEX "listings_buy_geo_idx";--> statement-breakpoint
CREATE INDEX "listings_buy_geo_idx" ON "listings" USING btree ("latitude","longitude") INCLUDE ("list_price", "idx_hidden") WHERE "removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon');--> statement-breakpoint
-- 5. Autocomplete's place names count only listings the public may see.
DROP MATERIALIZED VIEW "places";--> statement-breakpoint
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
