-- Keyword search's index (`keywordVector` in src/db/schema/listings.ts). An expression index,
-- so no listing row is rewritten. Plain CREATE INDEX (migrations run in a transaction, so no
-- CONCURRENTLY): it blocks writes to listings, not reads, while it builds; the MLS sync and
-- dashboard edits wait that long.
CREATE INDEX "listings_keyword_idx" ON "listings" USING gin ((to_tsvector('english', translate(
    coalesce("address_line1", '') || ' ' || coalesce("city", '') || ' ' ||
    coalesce("postal_code", '') || ' ' || coalesce("neighborhood", '') || ' ' ||
    coalesce("mls_number", '') || ' ' || coalesce("headline", '') || ' ' ||
    coalesce("property_sub_type", '') || ' ' || coalesce("description", ''), '/', ' ')) ||
  jsonb_to_tsvector('english', translate(coalesce("features", '{}'::jsonb)::text, '/', ' ')::jsonb, '["string"]')));