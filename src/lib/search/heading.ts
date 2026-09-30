import { site } from "@/config/site";
import { listingNoun, type SearchCriteria } from "./params";
import { hasLocation, lakeGuide, normalizeLocationQuery } from "./query";

/**
 * The lake a search names, for its heading: an area guide's lake ("Lanier" →
 * "Lake Lanier"), or any "Lake …" that isn't a town (statewide lakes have no
 * guide). Undefined for everything else.
 */
export function lakeName(q: string | undefined, town?: string): string | undefined {
  if (!q || town) return undefined;
  const guide = lakeGuide(q);
  if (guide) return guide.name;
  const text = normalizeLocationQuery(q);
  return /^lake\s/i.test(text) ? text : undefined;
}

/**
 * The results heading (site review #5), which follows the search:
 * - a town: "Homes for sale in Hartwell" (the town as the listings spell it);
 * - a lake: "Homes near Lake Hartwell";
 * - a moved map: "Homes in this map area";
 * - otherwise the place as typed, or the state: "Land for sale in Georgia".
 * The noun follows the mode and the property-type filter (`listingNoun`).
 */
export function searchHeading(
  c: Pick<SearchCriteria, "mode" | "types" | "q" | "bounds">,
  scope: { town?: string } = {},
): string {
  if (c.q && hasLocation(c)) {
    if (scope.town) return `${listingNoun(c)} in ${scope.town}`;
    const lake = lakeName(c.q);
    if (lake) return `${listingNoun(c, { bare: true })} near ${lake}`;
    return `${listingNoun(c)} in ${c.q}`;
  }
  if (c.bounds) return `${listingNoun(c, { bare: true })} in this map area`;
  return `${listingNoun(c)} in ${site.coverage.name}`;
}
