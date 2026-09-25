import {
  and,
  asc,
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
import { site } from "@/config/site";
import { listings, openHouses } from "@/db/schema";
import type { SearchCriteria } from "./params";

type Status = (typeof listings.status.enumValues)[number];

const BUY_STATUSES: Status[] = ["active", "coming_soon"];
const PENDING_STATUSES: Status[] = ["active_under_contract", "pending"];
const DEFAULT_SOLD_WINDOW_DAYS = 365;

const STATE_SUFFIX = new RegExp(`,?\\s+(${site.market.state}|${site.market.stateName})\\b`, "gi");

/**
 * "Decatur, GA" / "Decatur Georgia 30030" → "Decatur" / "Decatur 30030". The
 * state isn't part of the search vector, and every listing is in-market anyway.
 */
export function normalizeLocationQuery(q: string): string {
  return q.replace(STATE_SUFFIX, "").replace(/,/g, " ").replace(/\s+/g, " ").trim();
}

function locationCondition(rawQ: string): SQL | undefined {
  const q = normalizeLocationQuery(rawQ);
  if (!q) return undefined;
  if (/^\d{5}$/.test(q)) return eq(listings.postalCode, q);
  const like = q.replace(/[%_\\]/g, "\\$&");
  return or(
    sql`${listings.searchVector} @@ websearch_to_tsquery('english', ${q})`,
    // Prefix matches so a half-typed "trav" still finds Travis Heights.
    sql`${listings.city} ilike ${like + "%"}`,
    sql`${listings.neighborhood} ilike ${like + "%"}`,
    // Partial street addresses; served by the trigram index.
    sql`${listings.addressLine1} ilike ${"%" + like + "%"}`,
    eq(listings.mlsNumber, q),
  );
}

/** Monthly-equivalent HOA fee, so "max HOA $300/mo" compares like with like. */
const monthlyHoa = sql`(case ${listings.hoaFrequency}
  when 'quarterly' then ${listings.hoaFee} / 3.0
  when 'annually' then ${listings.hoaFee} / 12.0
  else ${listings.hoaFee} end)`;

/** Translates search criteria into SQL conditions. Pure — exported for tests. */
export function buildConditions(c: SearchCriteria, now: Date = new Date()): SQL[] {
  const conds: (SQL | undefined)[] = [isNull(listings.removedAt)];

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
    // Matches the GiST expression index `listings_geo_idx`.
    conds.push(
      sql`point(${listings.longitude}, ${listings.latitude}) <@ box(point(${west}, ${south}), point(${east}, ${north}))`,
    );
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
