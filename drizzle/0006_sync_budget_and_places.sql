-- Hand edits, which drizzle-kit cannot express:
--   1. INCLUDE ("slug", "updated_at") on listings_live_id_idx (index-only sitemap chunks).
--   2. The `places` materialized view and its indexes, at the end (declared
--      `.existing()` in src/db/schema/listings.ts, so drizzle-kit ignores it).
CREATE TYPE "public"."sync_mode" AS ENUM('incremental', 'full', 'purge');--> statement-breakpoint
ALTER TYPE "public"."sync_status" ADD VALUE 'partial';--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "mode" "sync_mode" DEFAULT 'incremental' NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "unchanged" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD COLUMN "cursor" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "listings_live_id_idx" ON "listings" USING btree ("id") INCLUDE ("slug", "updated_at") WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending');--> statement-breakpoint
-- Location autocomplete: one row per place name among live listings, with its
-- listing count. Same scope and grouping as the query it replaces in
-- getLocationSuggestions. Refreshed (CONCURRENTLY, so reads never block) by
-- refreshPlaces() after every sync, seed and dashboard listing change.
CREATE MATERIALIZED VIEW "places" AS
  SELECT "kind", "label", "sublabel", count(*)::int AS "n" FROM (
    SELECT 'neighborhood'::text AS "kind", "neighborhood" AS "label", "city" AS "sublabel"
      FROM "listings"
      WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending')
        AND "neighborhood" IS NOT NULL
    UNION ALL
    SELECT 'city', "city", "state"
      FROM "listings"
      WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending')
    UNION ALL
    SELECT 'zip', "postal_code", "city"
      FROM "listings"
      WHERE "removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending')
  ) s
  GROUP BY "kind", "label", "sublabel";--> statement-breakpoint
CREATE UNIQUE INDEX "places_key_idx" ON "places" ("kind", "label", "sublabel");--> statement-breakpoint
CREATE INDEX "places_label_idx" ON "places" (lower("label") text_pattern_ops);
