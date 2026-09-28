/**
 * Listing sitemap layout, fixed in code so neither the build nor robots.txt
 * needs a database: CHUNKS files of at most CHUNK_SIZE URLs each (about 2 MB
 * of XML, under Vercel's 4.5 MB response limit and Google's 50,000 URLs), at
 * /homes/sitemap/<id>.xml. 12 × 10,000 = 120,000 live listings, over twice
 * Georgia MLS's roughly 53,000 today; chunks past the end are empty. Raise
 * CHUNKS if the feed ever nears the capacity (the last chunk filling up is the
 * sign; src/app/homes/sitemap.ts logs it).
 */
export const LISTING_SITEMAP_CHUNKS = 12;
export const LISTING_SITEMAP_CHUNK_SIZE = 10_000;

export function listingSitemapIds(): Array<{ id: number }> {
  return Array.from({ length: LISTING_SITEMAP_CHUNKS }, (_, id) => ({ id }));
}

/** Absolute URLs of every listing sitemap chunk, for robots.txt. */
export function listingSitemapUrls(base: string): string[] {
  return listingSitemapIds().map(({ id }) => `${base}/homes/sitemap/${id}.xml`);
}

/** Parses a chunk id from the route ("0".."11"); anything else is null. */
export function parseChunkId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return id < LISTING_SITEMAP_CHUNKS ? id : null;
}
