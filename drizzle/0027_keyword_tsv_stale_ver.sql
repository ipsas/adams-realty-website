-- 0026's trigger function, now also nulling the version when a write changes keyword_tsv but not
-- keyword_tsv_ver: an upsert from a deploy older than 0026 writes a vector of its own (unmasked
-- text, or NULL for a partial write) and never sets the version, which would otherwise still say
-- current and keep the backfill off the row. The new vector is kept (search uses it) until the
-- backfill rewrites it. The trigger (0024) still fires only on writes that set a keyword column,
-- as every upsertListings write does. A trigger can't tell a version left alone from one set to
-- its stored value, so the current upsertListings, changing a row's text at the current version,
-- also leaves it stale: one more rewrite (the same vector) by the backfill the sync cron runs after
-- the sync. Search reads only keyword_tsv; the stale row just holds off recordKeywordTsvVersion.
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
  ELSIF NEW.keyword_tsv IS DISTINCT FROM OLD.keyword_tsv
     AND NEW.keyword_tsv_ver IS NOT DISTINCT FROM OLD.keyword_tsv_ver THEN
    NEW.keyword_tsv_ver := NULL;
  END IF;
  RETURN NEW;
END;
$$;
