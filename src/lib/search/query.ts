import {
  and,
  asc,
  between,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { findArea, normalizeAreaName, type Area } from "@/config/areas";
import { site } from "@/config/site";
import { listings, openHouses } from "@/db/schema";
import { areaCondition, normalizedMatch } from "@/lib/areas/match";
import { ACCESS_CODE_PG, ACCESS_CODE_PG_REPLACEMENT } from "@/lib/listings/excluded-fields";
import { publicConditions } from "@/lib/listings/visibility";
import { marketDateDaysAgo } from "@/lib/time";
import { allowsPriceReduced, type SearchCriteria } from "./params";

type Status = (typeof listings.status.enumValues)[number];

const BUY_STATUSES: Status[] = ["active", "coming_soon"];
const PENDING_STATUSES: Status[] = ["active_under_contract", "pending"];
export const DEFAULT_SOLD_WINDOW_DAYS = 365;

/** search_vector's text with the description as the listing page shows it (`redactAccessCodes`). */
const shownSearchText = sql`to_tsvector('english', concat_ws(' ',
  ${listings.addressLine1}, ${listings.city}, ${listings.postalCode}, ${listings.neighborhood},
  ${listings.mlsNumber}, ${listings.headline}, ${listings.propertySubType},
  regexp_replace(${listings.description}, ${ACCESS_CODE_PG}, ${ACCESS_CODE_PG_REPLACEMENT}, 'gi')))`;

const STATE = `(?:${site.market.state}|${site.market.stateName})`;
const COUNTRY_SUFFIX = /,?\s*(?:USA|U\.S\.A\.|US|United States)\s*$/i;
/** The state alone ("Georgia", "GA"): every listing is in the state, so no location. */
const STATE_ONLY = new RegExp(`^${STATE}$`, "i");
/** The state at the end, optionally before a ZIP: "Royston, GA" / "Royston, GA 30662". */
const STATE_SUFFIX = new RegExp(`,?\\s+${STATE}(?=\\s*(?:\\d{5})?\\s*$)`, "i");

/**
 * "Royston, GA" / "Royston Georgia 30662" → "Royston" / "Royston 30662", and a
 * bare "Georgia", "GA" or "Georgia, USA" → "" (no location). The state isn't
 * part of the location vector. Only a trailing state is dropped, so "The
 * Georgia Club" stays a place name.
 */
export function normalizeLocationQuery(q: string): string {
  const trimmed = q.trim().replace(COUNTRY_SUFFIX, "").trim();
  if (STATE_ONLY.test(trimmed)) return "";
  return trimmed.replace(STATE_SUFFIX, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

/** Whether the criteria search a place (a `q` that is more than just the state). */
export function hasLocation(c: Pick<SearchCriteria, "q">): boolean {
  return !!c.q && normalizeLocationQuery(c.q) !== "";
}

/**
 * What the location box's text turned out to be, resolved against the
 * listings (`resolveTown` in ./place.ts). Only a town changes the SQL: the
 * rest is known from the text alone.
 */
export type LocationScope = {
  /** The town `q` names exactly (a city some listing is in), as the listings spell it. */
  town?: string;
};

/**
 * The area guide a lake search names ("Lake Hartwell", "Hartwell Lake",
 * "Lanier"): a guide that isn't a town. Such a search covers the lake area,
 * whatever town each home's mail goes to.
 */
export function lakeGuide(q: string | undefined): Area | undefined {
  if (!q) return undefined;
  const area = findArea(normalizeLocationQuery(q));
  return area && normalizeAreaName(area.name) !== normalizeAreaName(area.city) ? area : undefined;
}

/**
 * The location box. A town ("Hartwell") means homes in that town and nothing
 * else (site review #5: it used to pull in every "Lake Hartwell" home in
 * Lavonia and Toccoa too). Anything else matches where a listing is (address,
 * city, ZIP, neighborhood, lake, MLS number) through `location_vector`, never
 * the description, so "Atlanta" means homes in Atlanta, not every listing
 * "minutes from Atlanta". Each branch has an index (GIN, trigram, btree, or
 * the area-guide expression indexes), so the OR stays a bitmap scan.
 */
function locationCondition(rawQ: string, scope: LocationScope): SQL | undefined {
  const q = normalizeLocationQuery(rawQ);
  if (!q) return undefined;
  if (/^\d{5}$/.test(q)) return eq(listings.postalCode, q);
  if (scope.town) return normalizedMatch(listings.city, [normalizeAreaName(scope.town)]);
  const like = q.replace(/[%_\\]/g, "\\$&");
  // A guide name or alias ("Lake Hartwell", "Hartwell Lake", "Lanier") also
  // matches the way its guide does: the exact neighborhood or lake name, or
  // the town, inside the guide's counties. Real feeds often name the lake
  // only in WaterBodyName, sometimes by an alias whose words `q` lacks.
  const area = findArea(q);
  return or(
    sql`${listings.locationVector} @@ websearch_to_tsquery('simple', ${q})`,
    // Prefix matches so a half-typed "flowery" still finds Flowery Branch.
    sql`${listings.city} ilike ${like + "%"}`,
    sql`${listings.neighborhood} ilike ${like + "%"}`,
    // Partial street addresses; served by the trigram index.
    sql`${listings.addressLine1} ilike ${"%" + like + "%"}`,
    eq(listings.mlsNumber, q),
    area ? areaCondition(area) : undefined,
  );
}

/** Just the location part of a search (any status), for finding where a place is. */
export function locationWhere(q: string, scope: LocationScope = {}): SQL | undefined {
  return locationCondition(q, scope);
}

/**
 * Commercial property is left out unless the buyer picks property types (site
 * review #5): a "Homes for sale" search full of storefronts reads "— bd · — ba".
 * Land and farms stay in (owner decision: land is a core part of this market).
 */
export const DEFAULT_EXCLUDED_TYPES = ["commercial"] as const;

/** The default search's property types: everything but `DEFAULT_EXCLUDED_TYPES`. */
export function defaultTypesCondition(): SQL {
  return ne(listings.propertyType, DEFAULT_EXCLUDED_TYPES[0]);
}

/**
 * Listed in the last `days` days: the "Days on market" filter, and the home
 * page's "New this week" count, which must match what its link lists.
 */
export function listedWithin(days: number, now: Date = new Date()): SQL {
  const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
  return gte(listings.listDate, since);
}

/**
 * Sold (a closed sale) in the last `days` days: sold mode's filter, and the agent
 * page's sales count and sold cards, which must match what the sold search lists.
 * Counted in America/New_York local days (`marketDateDaysAgo`).
 */
export function soldWithin(days: number = DEFAULT_SOLD_WINDOW_DAYS, now: Date = new Date()): SQL[] {
  // The market's calendar date, like the purge's own-closed cutoff (`purgeScope`).
  const since = marketDateDaysAgo(days, now);
  // Separate conditions, so sold mode's indexes still match each (indexes.test.ts).
  return [
    eq(listings.status, "closed"),
    eq(listings.transactionType, "sale"),
    gte(listings.closeDate, since),
  ];
}

/** Monthly-equivalent HOA fee, so "max HOA $300/mo" compares like with like. */
const monthlyHoa = sql`(case ${listings.hoaFrequency}
  when 'quarterly' then ${listings.hoaFee} / 3.0
  when 'annually' then ${listings.hoaFee} / 12.0
  else ${listings.hoaFee} end)`;

export const SQFT_PER_ACRE = 43_560;
/** 20,000 acres. Larger lot sizes are feed errors, so an acreage filter never matches them. */
export const MAX_PLAUSIBLE_LOT_SQFT = 20_000 * SQFT_PER_ACRE;

/**
 * Translates search criteria into SQL conditions. Pure — exported for tests.
 * `scope` says whether `q` is a town (resolved by the caller from the
 * listings; see ./place.ts); without it, `q` is matched as free text.
 */
export function buildConditions(
  c: SearchCriteria,
  now: Date = new Date(),
  scope: LocationScope = {},
): SQL[] {
  // Still listed, and not hidden by Georgia MLS rules (src/lib/listings/visibility.ts).
  const conds: (SQL | undefined)[] = [...publicConditions()];

  if (c.mode === "sold") {
    conds.push(...soldWithin(c.soldWithinDays ?? DEFAULT_SOLD_WINDOW_DAYS, now));
  } else {
    const statuses = c.mode === "rent" ? (["active"] as Status[]) : BUY_STATUSES;
    conds.push(
      eq(listings.transactionType, c.mode === "rent" ? "rent" : "sale"),
      inArray(listings.status, c.pending ? [...statuses, ...PENDING_STATUSES] : statuses),
    );
  }

  if (c.q) conds.push(locationCondition(c.q, scope));
  if (c.minPrice !== undefined) conds.push(gte(listings.listPrice, c.minPrice));
  if (c.maxPrice !== undefined) conds.push(lte(listings.listPrice, c.maxPrice));
  if (c.beds !== undefined) conds.push(gte(listings.bedrooms, c.beds));
  if (c.baths !== undefined) conds.push(gte(listings.bathrooms, c.baths));
  conds.push(c.types?.length ? inArray(listings.propertyType, c.types) : defaultTypesCondition());
  if (c.minSqft !== undefined) conds.push(gte(listings.livingAreaSqft, c.minSqft));
  if (c.maxSqft !== undefined) conds.push(lte(listings.livingAreaSqft, c.maxSqft));
  if (c.minLotSqft !== undefined) conds.push(gte(listings.lotSizeSqft, c.minLotSqft));
  // An acreage bound needs a known, plausible lot size; with no bound, unknowns show.
  if (c.minAcres !== undefined || c.maxAcres !== undefined) {
    conds.push(
      sql`${listings.lotSizeSqft} > 0`,
      lte(listings.lotSizeSqft, MAX_PLAUSIBLE_LOT_SQFT),
      c.minAcres !== undefined
        ? gte(listings.lotSizeSqft, Math.round(c.minAcres * SQFT_PER_ACRE))
        : undefined,
      c.maxAcres !== undefined
        ? lte(listings.lotSizeSqft, Math.round(c.maxAcres * SQFT_PER_ACRE))
        : undefined,
    );
  }
  if (c.minYear !== undefined) conds.push(gte(listings.yearBuilt, c.minYear));
  if (c.maxYear !== undefined) conds.push(lte(listings.yearBuilt, c.maxYear));
  if (c.maxHoa !== undefined)
    conds.push(or(isNull(listings.hoaFee), sql`${monthlyHoa} <= ${c.maxHoa}`));
  // The same rule as the listing page (hoaStatus in src/lib/listings/detail-fields.ts):
  // a true AssociationYN or a fee is "yes"; otherwise AssociationYN false or a $0 fee is "no".
  if (c.hoa === "yes") {
    conds.push(sql`(${listings.associationYN} = true or ${listings.hoaFee} > 0)`);
  } else if (c.hoa === "no") {
    // An unknown AssociationYN counts as "no" only with a stated $0 fee.
    conds.push(
      sql`((${listings.associationYN} = false and (${listings.hoaFee} is null or ${listings.hoaFee} <= 0)) or (${listings.associationYN} is null and ${listings.hoaFee} = 0))`,
    );
  }
  if (c.age55 === "only") conds.push(eq(listings.seniorCommunity, true));
  else if (c.age55 === "exclude") conds.push(sql`${listings.seniorCommunity} is not true`);
  // Keywords search the listing text (headline, description), apart from the location box.
  // search_vector (indexed) holds the raw description; the match must also hold on the
  // text as shown, codes masked, so a keyword search can't confirm a lockbox code.
  if (c.kw) {
    const kw = sql`websearch_to_tsquery('english', ${c.kw})`;
    conds.push(sql`${listings.searchVector} @@ ${kw}`, sql`${shownSearchText} @@ ${kw}`);
  }
  if (c.priceReduced && allowsPriceReduced(c.mode)) {
    conds.push(
      isNotNull(listings.originalListPrice),
      sql`${listings.listPrice} < ${listings.originalListPrice}`,
    );
  }
  if (c.maxDaysOnMarket !== undefined) conds.push(listedWithin(c.maxDaysOnMarket, now));

  if (c.garage) conds.push(gte(listings.garageSpaces, 1));
  if (c.pool) conds.push(eq(listings.hasPool, true));
  if (c.waterfront) conds.push(eq(listings.isWaterfront, true));
  if (c.view) conds.push(eq(listings.hasView, true));
  if (c.basement) conds.push(eq(listings.hasBasement, true));
  if (c.newConstruction) conds.push(eq(listings.isNewConstruction, true));
  if (c.singleStory) conds.push(eq(listings.isSingleStory, true));
  if (c.virtualTour) conds.push(isNotNull(listings.virtualTourUrl));
  if (c.ourListings) conds.push(eq(listings.isCompanyListing, true));
  if (c.fireplace) conds.push(gte(listings.fireplacesTotal, 1));
  if (c.openHouse) {
    conds.push(
      sql`exists (select 1 from ${openHouses} where ${openHouses.listingId} = ${listings.id} and ${openHouses.endsAt} > ${now})`,
    );
  }

  if (c.bounds) {
    const { west, south, east, north } = c.bounds;
    // Plain ranges, not a GiST point-in-box: the planner estimates ranges from
    // column statistics (a box gets a fixed guess of a few dozen rows, so a
    // statewide viewport was planned like a tiny one), and the partial
    // (latitude, longitude) btree serves small boxes.
    conds.push(between(listings.longitude, west, east), between(listings.latitude, south, north));
  }

  return conds.filter((x): x is SQL => x !== undefined);
}

export function buildWhere(c: SearchCriteria, now?: Date, scope?: LocationScope): SQL | undefined {
  return and(...buildConditions(c, now, scope));
}

export function buildOrderBy(c: SearchCriteria): SQL[] {
  const tiebreak = asc(listings.id);
  switch (c.sort) {
    case "newest":
      return c.mode === "sold"
        ? [sql`${listings.closeDate} desc nulls last`, tiebreak]
        : [sql`${listings.listDate} desc nulls last`, tiebreak];
    case "price_asc":
      return [asc(listings.listPrice), tiebreak];
    case "price_desc":
      return [desc(listings.listPrice), tiebreak];
    case "sqft_desc":
      return [sql`${listings.livingAreaSqft} desc nulls last`, tiebreak];
    case "price_per_sqft_asc":
      return [
        sql`(${listings.listPrice}::float / nullif(${listings.livingAreaSqft}, 0)) asc nulls last`,
        tiebreak,
      ];
    case "lot_desc":
      return [sql`${listings.lotSizeSqft} desc nulls last`, tiebreak];
    case "price_per_acre_asc":
      // Price per square foot of lot orders exactly like price per acre.
      return [
        sql`(${listings.listPrice}::float / nullif(${listings.lotSizeSqft}, 0)) asc nulls last`,
        tiebreak,
      ];
    case "recommended":
    default:
      // Featured first, then fresh listings, then photo-rich ones.
      return [
        desc(listings.isFeatured),
        c.mode === "sold"
          ? sql`${listings.closeDate} desc nulls last`
          : sql`${listings.listDate} desc nulls last`,
        desc(listings.photoCount),
        tiebreak,
      ];
  }
}
