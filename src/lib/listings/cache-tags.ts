/**
 * Cache tag on every listing-derived cached query (src/lib/listings/cached.ts).
 * The cron sync revalidates it; dashboard listing actions update it. A CLI sync
 * can't reach the running app's cache, so entries also expire on their own
 * after LISTINGS_CACHE_SECONDS.
 */
export const LISTINGS_TAG = "listings";

/** Backstop lifetime of cached listing data (15 minutes, the sync interval on Vercel Pro). */
export const LISTINGS_CACHE_SECONDS = 900;
