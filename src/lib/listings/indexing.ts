import { isFirmArea, type FirmAreaListing } from "@/lib/areas/firm-area";

/**
 * Which listing pages search engines may index. Listings cover all of
 * Georgia, but only the firm's own and those in its area are worth indexing;
 * the rest stay reachable (noindex, follow) and out of the sitemaps.
 *
 * One switch, `LISTINGS_INDEXING`:
 * - `area` (the default, also when unset or empty): index the firm's own
 *   listings and live listings in the firm's area (`isFirmArea`); the listing
 *   sitemaps hold exactly those.
 * - `none`: noindex on every listing page and no listing sitemaps.
 * Any other value means `none`, with a warning: a typo must never index
 * everything.
 *
 * Read from `process.env` on every call, like src/lib/demo-mode.ts, so
 * changing it needs no rebuild. Database-free: robots.ts imports it.
 */

type EnvLike = Record<string, string | undefined>;

export type ListingIndexingMode = "none" | "area";

export const DEFAULT_LISTING_INDEXING: ListingIndexingMode = "area";

let warned = false;

export function listingIndexingMode(e: EnvLike = process.env): ListingIndexingMode {
  const v = e.LISTINGS_INDEXING?.trim().toLowerCase();
  if (!v) return DEFAULT_LISTING_INDEXING;
  if (v === "none" || v === "area") return v;
  if (!warned) {
    warned = true;
    console.warn(
      `LISTINGS_INDEXING=${JSON.stringify(e.LISTINGS_INDEXING)} is not "none" or "area": indexing no listings.`,
    );
  }
  return "none";
}

export type IndexableListing = FirmAreaListing & {
  status: string;
  isCompanyListing: boolean;
  removedAt: Date | null;
};

const NOINDEX = { index: false, follow: true } as const;

/** The `robots` metadata for a listing page; undefined means indexable. */
export function listingRobots(
  l: IndexableListing,
  mode: ListingIndexingMode,
): { index: false; follow: true } | undefined {
  // IDX: off-market listings stay reachable for people who saved them, but aren't indexed.
  if (l.removedAt) return NOINDEX;
  if (mode === "none") return NOINDEX;
  // Sold: the page stays, but it isn't a home for sale.
  if (l.status === "closed") return NOINDEX;
  if (!l.isCompanyListing && !isFirmArea(l)) return NOINDEX;
  return undefined;
}
