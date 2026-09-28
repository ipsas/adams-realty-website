import { sql, type SQL } from "drizzle-orm";
import { areas } from "@/config/areas";
import { site } from "@/config/site";
import { listings } from "@/db/schema";
import {
  areaCondition,
  guideForLocation,
  normalizeCounty,
  normalizedCountySql,
  textArray,
} from "./match";

/**
 * Whether a listing is in the firm's own area: Northeast Georgia, where Adams
 * Realty's agents work and tour homes. Listings cover all of Georgia; outside
 * this area a listing offers "Ask a question" (answered by the office) instead
 * of a tour, and never appears under "Handpicked by our agents".
 *
 * County-scoped: a listing is in the area when its county is one the firm
 * serves (`site.market.counties`), or when it belongs to one of our area
 * guides inside that guide's counties (Lake Lanier homes in Forsyth County,
 * Braselton homes in Barrow). Names alone never count: a subdivision called
 * "Jefferson" in Chatham County is not Jefferson, Jackson County. A listing
 * with no county can't be placed, so it is outside (it still gets the
 * question form, which is always safe).
 */
export type FirmAreaListing = {
  county: string | null;
  city: string | null;
  neighborhood?: string | null;
  waterBodyName?: string | null;
};

const FIRM_COUNTIES = site.market.counties.map(normalizeCounty);

export function isFirmArea(l: FirmAreaListing): boolean {
  if (!l.county) return false;
  if (FIRM_COUNTIES.includes(normalizeCounty(l.county))) return true;
  return !!guideForLocation(l.neighborhood, l.city, l.county, l.waterBodyName);
}

/**
 * Whether a listing page offers tour requests: the firm's own listings (its
 * agent can always show them) and homes in the firm's area.
 */
export function offersTours(l: FirmAreaListing & { isCompanyListing: boolean }): boolean {
  return l.isCompanyListing || isFirmArea(l);
}

/** SQL twin of `isFirmArea`, for listing queries. */
export function firmAreaCondition(): SQL {
  const guides = areas.map((a) => areaCondition(a));
  return sql`(${listings.county} is not null and (${normalizedCountySql(listings.county)} = any(${textArray(
    FIRM_COUNTIES,
  )}) or ${sql.join(guides, sql` or `)}))`;
}
