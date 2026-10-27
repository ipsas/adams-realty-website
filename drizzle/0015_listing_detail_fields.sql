-- Listing detail fields from the RESO feed (mapper version 3): AssociationYN, so "no HOA" and
-- "unknown" differ, plus fireplaces, parking, 55+ community, assessed value, lot dimensions, zoning.
-- All nullable; the next incremental sync rewrites stored rows to fill them.
ALTER TABLE "listings" ADD COLUMN "fireplaces_total" smallint;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "parking_total" smallint;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "senior_community" boolean;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "lot_size_dimensions" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "zoning" text;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "association_yn" boolean;--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "tax_assessed_value" integer;