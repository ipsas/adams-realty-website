DROP INDEX "listings_keyword_tsv_missing_idx";--> statement-breakpoint
ALTER TABLE "listings" ADD COLUMN "keyword_tsv_ver" smallint;--> statement-breakpoint
CREATE INDEX "listings_keyword_tsv_ver_idx" ON "listings" USING btree ("keyword_tsv_ver");--> statement-breakpoint
-- keyword_tsv_ver is the KEYWORD_TSV_VERSION (src/lib/search/keyword-text.ts) keyword_tsv was built
-- under. No row is updated here: existing rows have keyword_tsv_ver NULL (stale) and keep their
-- vector, searchable, until the backfill (scripts/keyword-backfill.ts, the sync cron) rewrites them.
-- 0024's trigger function, now also nulling the version along with the vector.
CREATE OR REPLACE FUNCTION listings_keyword_tsv_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.address_line1, NEW.city, NEW.postal_code, NEW.neighborhood, NEW.mls_number,
      NEW.headline, NEW.property_sub_type, NEW.description, NEW.features)
     IS DISTINCT FROM
     (OLD.address_line1, OLD.city, OLD.postal_code, OLD.neighborhood, OLD.mls_number,
      OLD.headline, OLD.property_sub_type, OLD.description, OLD.features)
     AND NEW.keyword_tsv IS NOT DISTINCT FROM OLD.keyword_tsv THEN
    NEW.keyword_tsv := NULL;
    NEW.keyword_tsv_ver := NULL;
  END IF;
  RETURN NEW;
END;
$$;
