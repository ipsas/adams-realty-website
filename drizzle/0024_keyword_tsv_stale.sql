-- keyword_tsv can't go stale: a write that changes a keyword source column without giving
-- keyword_tsv a new value (raw SQL, an older deploy's upsert) nulls it, and the sync cron's backfill
-- (`backfillKeywordTsv`) refills it from the row. The column list must match KEYWORD_FIELDS
-- (src/lib/search/keyword-text.ts). `UPDATE OF` keeps it off other updates (removed_at,
-- updated_at, the backfill's keyword_tsv-only write). No INSERT trigger: a writer that doesn't set
-- the column leaves it NULL, and ON CONFLICT DO UPDATE runs this UPDATE trigger. A persist.ts
-- write whose new text yields the identical vector (only a masked code changed) is nulled too,
-- which is harmless: the backfill writes the same vector back.
CREATE FUNCTION listings_keyword_tsv_stale() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.address_line1, NEW.city, NEW.postal_code, NEW.neighborhood, NEW.mls_number,
      NEW.headline, NEW.property_sub_type, NEW.description, NEW.features)
     IS DISTINCT FROM
     (OLD.address_line1, OLD.city, OLD.postal_code, OLD.neighborhood, OLD.mls_number,
      OLD.headline, OLD.property_sub_type, OLD.description, OLD.features)
     AND NEW.keyword_tsv IS NOT DISTINCT FROM OLD.keyword_tsv THEN
    NEW.keyword_tsv := NULL;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER listings_keyword_tsv_stale
  BEFORE UPDATE OF address_line1, city, postal_code, neighborhood, mls_number,
    headline, property_sub_type, description, features
  ON listings
  FOR EACH ROW EXECUTE FUNCTION listings_keyword_tsv_stale();--> statement-breakpoint
-- The masker changed (redactAccessCodes, src/lib/listings/excluded-fields.ts), so every stored
-- vector may hold a code it now masks: rebuild them all. The deploy build refills them before
-- traffic switches (scripts/keyword-backfill.ts, run by scripts/vercel-build.mjs); the sync cron
-- finishes any left. WHERE: a database where nothing was filled rewrites no rows.
UPDATE listings SET keyword_tsv = NULL WHERE keyword_tsv IS NOT NULL;
