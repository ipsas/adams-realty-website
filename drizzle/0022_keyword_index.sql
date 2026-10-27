-- Superseded by 0023 (a stored keyword_tsv column). This built "listings_keyword_idx", a slow
-- expression index over every listing's text, inside the deploy's migration transaction, blocking
-- listing writes while it ran. Kept as a no-op so the journal stays as applied; 0023 drops the
-- index where an earlier deploy built it.
SELECT 1;
