-- Statewide cutover (docs/plans/dark-mode-and-georgia.md, review correction 12).
-- While the site covered Northeast Georgia only, a saved search with no
-- location meant "Northeast Georgia". Once listings cover all of Georgia the
-- same criteria would match the whole state, and its alert emails would fill
-- with homes the buyer never asked for. Every saved search that exists when
-- this runs was made before the cutover, so each one with no location is
-- pinned to the firm's counties' extent (site.market.bounds in
-- src/config/site.ts; src/lib/search/saved-search-cutover.db.test.ts checks
-- that the two agree). "Georgia" and "GA" alone count as no location, as in
-- the search parser. Searches with a place or map bounds are left alone.
UPDATE "saved_searches"
SET "criteria" = ("criteria" - 'q') || jsonb_build_object(
  'bounds', jsonb_build_object('west', -84.28, 'south', 33.75, 'east', -82.77, 'north', 34.69)
)
WHERE jsonb_typeof("criteria"->'bounds') IS DISTINCT FROM 'object'
  AND (
    "criteria"->>'q' IS NULL
    OR btrim("criteria"->>'q') = ''
    OR "criteria"->>'q' ~* '^\s*(ga|georgia)(\s*,?\s*usa)?\s*$'
  );
