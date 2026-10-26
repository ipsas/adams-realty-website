import { areaHref } from "@/config/areas";
import { searchHref } from "@/lib/search/params";
import { guideForLocation } from "./match";

/**
 * Where a listing's town or neighborhood links: its area guide when we publish one
 * for that place in the listing's county (`guideForLocation`), otherwise a search
 * for the name. A "Jefferson" in Chatham County is not Jefferson, Jackson County.
 */
export function placeHref(place: string, county: string | null | undefined): string {
  const guide = guideForLocation(null, place, county);
  return guide ? areaHref(guide) : searchHref({ q: place });
}
