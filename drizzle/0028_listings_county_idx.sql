-- Serves the county search's and autocomplete's prefilter, `lower(county) like 'hall%'`
-- (src/lib/search/query.ts, place.ts; getLocationSuggestions), a seq scan without it. A small btree,
-- built inside the deploy's migration transaction (no CONCURRENTLY there), so it blocks listing
-- writes briefly while it builds.
CREATE INDEX "listings_county_idx" ON "listings" USING btree (lower("county") text_pattern_ops);