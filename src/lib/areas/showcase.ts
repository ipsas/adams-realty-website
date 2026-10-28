import { sql } from "drizzle-orm";
import { listings } from "@/db/schema";

/**
 * Which homes may front an area guide (its featured slot and listing cards).
 * Left out: a pricey listing with no living area (usually a development tract
 * or commercial site entered as a home) and street number 0 (a placeholder
 * address, e.g. "0 Jesse Jewell Parkway"). The schema has no street-number
 * column; the mapper builds address_line1 from StreetNumber first.
 * Search (/homes) still shows them.
 */

/** Above this asking price a listing with no living area is left off the guide. */
export const SHOWCASE_MAX_PRICE_WITHOUT_SQFT = 1_000_000;
/** address_line1 starting with street number 0 ("0", "00"…). Same pattern in SQL and JS. */
const ZERO_STREET_NUMBER = "^0+(\\s|$)";

type ShowcaseFields = {
  livingAreaSqft: number | null;
  listPrice: number;
  addressLine1: string;
};

/** True for a listing kept off the guide's featured slot and cards. */
export function isShowcaseJunk(l: ShowcaseFields): boolean {
  return (
    (!l.livingAreaSqft && l.listPrice > SHOWCASE_MAX_PRICE_WITHOUT_SQFT) ||
    new RegExp(ZERO_STREET_NUMBER).test(l.addressLine1.trim())
  );
}

/** SQL twin of `!isShowcaseJunk`, shared by getAreaListings and getAreaFeaturedListing. */
export function showcaseListing() {
  const L = listings;
  return sql`not (
    (coalesce(${L.livingAreaSqft}, 0) = 0 and ${L.listPrice} > ${SHOWCASE_MAX_PRICE_WITHOUT_SQFT})
    or btrim(${L.addressLine1}) ~ ${ZERO_STREET_NUMBER}
  )`;
}
