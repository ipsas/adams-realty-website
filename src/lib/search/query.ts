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
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { findArea } from "@/config/areas";
import { site } from "@/config/site";
import { listings, openHouses } from "@/db/schema";
import { areaCondition } from "@/lib/areas/match";
import { publicConditions } from "@/lib/listings/visibility";
import type { SearchCriteria } from "./params";

type Status = (typeof listings.status.enumValues)[number];

const BUY_STATUSES: Status[] = ["active", "coming_soon"];
const PENDING_STATUSES: Status[] = ["active_under_contract", "pending"];
const DEFAULT_SOLD_WINDOW_DAYS = 365;

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
 * The location box. It matches where a listing is (address, city, ZIP,
 * neighborhood, lake, MLS number) through `location_vector`, never the
 * description, so "Atlanta" means homes in Atlanta, not every listing
 * "minutes from Atlanta". Each branch has an index (GIN, trigram, btree, or
 * the area-guide expression indexes), so the OR stays a bitmap scan.
 */
function locationCondition(rawQ: string): SQL | undefined {
  const q = normalizeLocationQuery(rawQ);
  if (!q) return undefined;
  if (/^\d{5}$/.test(q)) return eq(listings.postalCode, q);
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

/** Monthly-equivalent HOA fee, so "max HOA $300/mo" compares like with like. */
const monthlyHoa = sql`(case ${listings.hoaFrequency}
  when 'quarterly' then ${listings.hoaFee} / 3.0
  when 'annually' then ${listings.hoaFee} / 12.0
  else ${listings.hoaFee} end)`;

/** Translates search criteria into SQL conditions. Pure — exported for tests. */
export function buildConditions(c: SearchCriteria, now: Date = new Date()): SQL[] {
  // Still listed, and not hidden by Georgia MLS rules (src/lib/listings/visibility.ts).
  const conds: (SQL | undefined)[] = [...publicConditions()];

  if (c.mode === "sold") {
    const days = c.soldWithinDays ?? DEFAULT_SOLD_WINDOW_DAYS;
    const since = new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
    conds.push(
      eq(listings.status, "closed"),
      eq(listings.transactionType, "sale"),
      gte(listings.closeDate, since),
    );
  } else {
    const statuses = c.mode === "rent" ? (["active"] as Status[]) : BUY_STATUSES;
    conds.push(
      eq(listings.transactionType, c.mode === "rent" ? "rent" : "sale"),
      inArray(listings.status, c.pending ? [...statuses, ...PENDING_STATUSES] : statuses),
    );
  }

  if (c.q) conds.push(locationCondition(c.q));
  if (c.minPrice !== undefined) conds.push(gte(listings.listPrice, c.minPrice));
  if (c.maxPrice !== undefined) conds.push(lte(listings.listPrice, c.maxPrice));
  if (c.beds !== undefined) conds.push(gte(listings.bedrooms, c.beds));
  if (c.baths !== undefined) conds.push(gte(listings.bathrooms, c.baths));
  if (c.types?.length) conds.push(inArray(listings.propertyType, c.types));
  if (c.minSqft !== undefined) conds.push(gte(listings.livingAreaSqft, c.minSqft));
  if (c.maxSqft !== undefined) conds.push(lte(listings.livingAreaSqft, c.maxSqft));
  if (c.minLotSqft !== undefined) conds.push(gte(listings.lotSizeSqft, c.minLotSqft));
  if (c.minYear !== undefined) conds.push(gte(listings.yearBuilt, c.minYear));
  if (c.maxYear !== undefined) conds.push(lte(listings.yearBuilt, c.maxYear));
  if (c.maxHoa !== undefined)
    conds.push(or(isNull(listings.hoaFee), sql`${monthlyHoa} <= ${c.maxHoa}`));
  if (c.maxDaysOnMarket !== undefined) {
    const since = new Date(now.getTime() - c.maxDaysOnMarket * 86_400_000)
      .toISOString()
      .slice(0, 10);
    conds.push(gte(listings.listDate, since));
  }

  if (c.garage) conds.push(gte(listings.garageSpaces, 1));
  if (c.pool) conds.push(eq(listings.hasPool, true));
  if (c.waterfront) conds.push(eq(listings.isWaterfront, true));
  if (c.view) conds.push(eq(listings.hasView, true));
  if (c.basement) conds.push(eq(listings.hasBasement, true));
  if (c.newConstruction) conds.push(eq(listings.isNewConstruction, true));
  if (c.singleStory) conds.push(eq(listings.isSingleStory, true));
  if (c.virtualTour) conds.push(isNotNull(listings.virtualTourUrl));
  if (c.ourListings) conds.push(eq(listings.isCompanyListing, true));
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

export function buildWhere(c: SearchCriteria, now?: Date): SQL | undefined {
  return and(...buildConditions(c, now));
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
