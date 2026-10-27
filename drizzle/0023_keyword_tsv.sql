-- Keyword search's stored vector (`keywordTsv` in src/db/schema/listings.ts). No data rewrite: a
-- nullable column without a default is a catalog change, and its GIN index builds fast over all
-- NULLs. The partial index on id (rows still NULL) starts out as a btree over every id, quick to
-- build, and empties as the sync cron fills the column (`backfillKeywordTsv`, which it serves);
-- upsertListings writes it from then on.
ALTER TABLE "listings" ADD COLUMN "keyword_tsv" tsvector;--> statement-breakpoint
CREATE INDEX "listings_keyword_tsv_idx" ON "listings" USING gin ("keyword_tsv");--> statement-breakpoint
CREATE INDEX "listings_keyword_tsv_missing_idx" ON "listings" USING btree ("id") WHERE "keyword_tsv" is null;--> statement-breakpoint
-- 0022 no longer builds it, so only databases that ran the old 0022 have it.
DROP INDEX IF EXISTS "listings_keyword_idx";
