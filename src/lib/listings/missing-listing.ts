import { areas, type Area } from "@/config/areas";
import { isMarketState } from "@/lib/state-name";
import { slugify } from "./slug";

/**
 * A missing listing's 404 links to its town's area guide. In Next 16.3 a
 * page-level `notFound()` on a matched route server-renders an empty error
 * shell (the not-found UI is only in the RSC payload; vercel/next.js #99793),
 * so the proxy looks the listing up first and, when it isn't shown, rewrites
 * to a URL no route matches: Next then server-renders the root not-found with
 * a 404. The guide travels in this request header. Pure (no database, no
 * React), so src/proxy.ts can import it.
 */
export const MISSING_LISTING_GUIDE_HEADER = "x-missing-listing-guide";

/** The slug in a listing page path (`/homes/<slug>`), decoded; null for any other path. */
export function listingPagePathSlug(path: string): string | null {
  const m = /^\/homes\/([^/]+)$/.exec(path);
  if (!m || m[1].endsWith(".xml")) return null;
  try {
    return decodeURIComponent(m[1]) || null;
  } catch {
    return null;
  }
}

const SLUG_TAIL = /^(.+)-ga-\d{5}(?:-\d{4})?-[0-9a-z]{7}$/;

/**
 * The guide for a missing listing's town, by exact slug only: a Hartwell
 * listing gets "hartwell", never "lake-hartwell". From the row when there is
 * one (Georgia only), else from the slug's `{address}-{city}-ga-{zip}-{hash}`
 * shape, trying the shortest city ending first so a street name can't win.
 */
export function guideSlugForMissingListing(
  slug: string,
  row?: { city: string; state: string } | null,
): string | undefined {
  if (row) return isMarketState(row.state) ? guideBySlug(slugify(row.city))?.slug : undefined;
  const m = SLUG_TAIL.exec(slug);
  if (!m) return undefined;
  const words = m[1].split("-");
  for (let k = 1; k <= Math.min(4, words.length); k++) {
    const guide = guideBySlug(words.slice(-k).join("-"));
    if (guide) return guide.slug;
  }
  return undefined;
}

/** The area guide with exactly this slug. The not-found page trusts the header only through this. */
export function guideBySlug(slug: string | null | undefined): Area | undefined {
  return slug ? areas.find((a) => a.slug === slug) : undefined;
}
