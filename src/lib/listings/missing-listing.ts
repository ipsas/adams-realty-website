import { cache } from "react";
import type { Area } from "@/config/areas";
import { areas } from "@/config/areas";
import { areaMatchKeys, guideForLocation } from "@/lib/areas/match";
import { isMarketState, MARKET_STATE_SPELLINGS } from "@/lib/state-name";
import { slugify } from "./slug";

/**
 * Hands a missing listing's slug from /homes/[slug] to its not-found.tsx, which gets no params.
 * Next renders a segment's not-found element in the same request as its page, but alongside
 * it, not after it, so the boundary awaits `slug`. The page always settles it: the slug
 * before `notFound()`, null once it knows the listing is shown (or its lookup threw).
 */
export const missingListing = cache(() => {
  let settle!: (slug: string | null) => void;
  const slug = new Promise<string | null>((resolve) => (settle = resolve));
  return { slug, settle };
});

/** The towns the guides match on `listings.city`, as slug segments, longest first. */
const GUIDE_CITY_SEGMENTS = [
  ...new Set(areas.flatMap((a: Area) => areaMatchKeys(a).cities.map(slugify))),
].sort((a, b) => b.length - a.length);

const STATE_SEGMENTS = MARKET_STATE_SPELLINGS.map(slugify);

/**
 * The area guide for a listing we can't show, if we publish one for its town. With its row
 * (a removed or sold listing), its own city and county decide (`guideForLocation`).
 * Without one, the town is read from the slug (`listingSlug`:
 * `{address}-{city}-{state}-{zip}-{hash}`): only the segment right before the state and
 * ZIP, and only when it's a town a guide matches on its city.
 */
export function guideForListingSlug(
  slug: string,
  row?: { city: string; state: string; county: string | null } | null,
): Area | undefined {
  if (row)
    return isMarketState(row.state) ? guideForLocation(null, row.city, row.county) : undefined;
  const place = /^(.+)-[0-9a-z]{7}$/.exec(slug)?.[1]?.replace(/-\d{5}(?:-\d{4})?$/, "");
  if (!place) return undefined;
  for (const state of STATE_SEGMENTS) {
    for (const city of GUIDE_CITY_SEGMENTS) {
      const tail = `${city}-${state}`;
      if (place === tail || place.endsWith(`-${tail}`)) {
        return guideForLocation(null, city.replace(/-/g, " "));
      }
    }
  }
  return undefined;
}
