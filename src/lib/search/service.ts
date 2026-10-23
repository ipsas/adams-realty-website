import { count, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { site } from "@/config/site";
import { listings } from "@/db/schema";
import { selectCards, withPhotos, type ListingCardData } from "@/lib/listings/card";
import { PAGE_SIZE, type SearchCriteria } from "./params";
import { resolveScope } from "./place";
import { buildOrderBy, buildWhere, hasLocation, type LocationScope } from "./query";

/**
 * Search entry points. Backed by Postgres (full-text + GiST geo index), which
 * comfortably handles a metro MLS (~50–100k listings). If we outgrow it, swap
 * the implementation of these two functions for Typesense/OpenSearch — the
 * rest of the app only depends on these signatures.
 */

export type SearchResult = {
  items: ListingCardData[];
  total: number;
  page: number;
  pageCount: number;
};

/**
 * `scope` is whether `q` names a town (./place.ts); callers that already know
 * pass it, else it's looked up.
 */
export async function searchListings(
  c: SearchCriteria,
  scope?: LocationScope,
): Promise<SearchResult> {
  const where = buildWhere(c, undefined, scope ?? (await resolveScope(db, c)));
  const [rows, [{ total }]] = await Promise.all([
    selectCards(db)
      .where(where)
      .orderBy(...buildOrderBy(c))
      .limit(PAGE_SIZE)
      .offset((c.page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(listings).where(where),
  ]);
  return {
    items: await withPhotos(db, rows),
    total,
    page: c.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** How many listings match `c` (no page of results). */
export async function countListings(c: SearchCriteria, scope?: LocationScope): Promise<number> {
  const where = buildWhere(c, undefined, scope ?? (await resolveScope(db, c)));
  const [{ total }] = await db.select({ total: count() }).from(listings).where(where);
  return total;
}

export type MapPin = {
  id: string;
  slug: string;
  lat: number;
  lng: number;
  price: number;
  status: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  /** Land shows "Land · X acres" in the preview instead of beds and baths. */
  propertyType: string;
  lotSqft: number | null;
  /** A rental's price is monthly rent: no price per acre. */
  rent: boolean;
  address: string;
  photo: string | null;
  featured: boolean;
  /** IDX: the popup names the listing firm, like every card. */
  office: string | null;
  /** A Georgia MLS listing: the popup also credits the MLS (name, logo, copyright). */
  fromFeed: boolean;
};

export const MAX_PINS = 750;

/**
 * Lightweight pins for every match (not just the current page), capped for
 * payload size: the first MAX_PINS in the search's order.
 *
 * Two ways to get them. Walking the order's index and testing each row reads
 * MAX_PINS / (share of rows that match) rows, one heap fetch each; collecting
 * every match through the location indexes (`locationPins`) and keeping the
 * first MAX_PINS reads each match once. For a location search Postgres
 * chooses badly: it can't estimate how the location match is spread along the
 * order, and walks even when that means tens of thousands of rows (sold homes
 * in Savannah: 20k rows, 70–130 ms, against 15 ms collected). So a location
 * search picks the way here (`walkPins`), from Postgres's own row estimates.
 */
export async function searchMapPins(c: SearchCriteria, scope?: LocationScope): Promise<MapPin[]> {
  const resolved = scope ?? (await resolveScope(db, c));
  if (hasLocation(c)) {
    const [matches, inScope] = await Promise.all([
      estimateRows(buildWhere(c, undefined, resolved)),
      estimateRows(buildWhere({ ...c, q: undefined })),
    ]);
    if (!walkPins(matches, inScope)) return locationPins(c, MAX_PINS, resolved);
  }
  const rows = await db
    .select({
      id: listings.id,
      slug: listings.slug,
      lat: listings.latitude,
      lng: listings.longitude,
      price: listings.listPrice,
      closePrice: listings.closePrice,
      status: listings.status,
      beds: listings.bedrooms,
      baths: listings.bathrooms,
      sqft: listings.livingAreaSqft,
      propertyType: listings.propertyType,
      lotSqft: listings.lotSizeSqft,
      transactionType: listings.transactionType,
      addressLine1: listings.addressLine1,
      unitNumber: listings.unitNumber,
      city: listings.city,
      hideAddress: listings.hideAddress,
      photo: listings.primaryPhotoUrl,
      featured: listings.isFeatured,
      office: listings.listOfficeName,
      company: listings.isCompanyListing,
      fromFeed: listings.fromFeed,
    })
    .from(listings)
    .where(buildWhere(c, undefined, resolved))
    .orderBy(...buildOrderBy(c))
    .limit(MAX_PINS);
  return toPins(rows);
}

/**
 * Whether walking the order index beats collecting the matches, given about
 * `matches` matching rows among `inScope` rows the walk passes through. A
 * walked row (a random heap fetch, then the location test) costs about twice
 * a collected one (bitmap order, measured on adams_perf), so walk only when it
 * reads no more than half as many rows. Exported for tests.
 */
export function walkPins(matches: number, inScope: number): boolean {
  if (matches <= 0) return false;
  const walked = Math.min(inScope, (MAX_PINS * inScope) / matches);
  return walked <= matches / 2;
}

/** Postgres's estimate of the rows matching `where` (planning only, no execution). */
async function estimateRows(where: SQL | undefined): Promise<number> {
  const { rows } = await db.execute<{ "QUERY PLAN": [{ Plan: { "Plan Rows": number } }] }>(
    sql`explain (format json) select 1 from ${listings} where ${where ?? sql`true`}`,
  );
  return rows[0]["QUERY PLAN"][0].Plan["Plan Rows"];
}

type PinRow = {
  id: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  price: number;
  closePrice: number | null;
  status: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  propertyType: string;
  lotSqft: number | null;
  transactionType: string;
  addressLine1: string;
  unitNumber: string | null;
  city: string;
  hideAddress: boolean;
  photo: string | null;
  featured: boolean;
  office: string | null;
  company: boolean;
  fromFeed: boolean;
};

/**
 * The first `limit` matches in the search's order, collected rather than
 * walked: the matches come from the location indexes (a bitmap), the first
 * `limit` are picked from them, and only those are read in full. Exported for
 * tests; `searchMapPins` decides when to use it.
 */
export async function locationPins(
  c: SearchCriteria,
  limit: number = MAX_PINS,
  scope?: LocationScope,
): Promise<MapPin[]> {
  const where = buildWhere(c, undefined, scope ?? (await resolveScope(db, c)));
  const order = sql.join(buildOrderBy(c), sql`, `);
  // buildOrderBy's column refs are qualified with "listings": the CTE rows
  // are aliased to that name so the same ORDER BY applies to them.
  const { rows } = await db.execute<PinRow>(sql`
    with matches as materialized (
      select "id", "is_featured", "list_date", "close_date", "photo_count", "list_price", "living_area_sqft", "lot_size_sqft"
      from ${listings}
      where ${where}
    ),
    top as (
      select "listings"."id" from matches as "listings" order by ${order} limit ${limit}
    )
    select
      "listings"."id", "listings"."slug",
      "listings"."latitude" as "lat", "listings"."longitude" as "lng",
      "listings"."list_price" as "price", "listings"."close_price" as "closePrice",
      "listings"."status", "listings"."bedrooms" as "beds", "listings"."bathrooms" as "baths",
      "listings"."living_area_sqft" as "sqft", "listings"."property_type" as "propertyType",
      "listings"."lot_size_sqft" as "lotSqft", "listings"."transaction_type" as "transactionType",
      "listings"."address_line1" as "addressLine1",
      "listings"."unit_number" as "unitNumber", "listings"."city",
      "listings"."hide_address" as "hideAddress", "listings"."primary_photo_url" as "photo",
      "listings"."is_featured" as "featured",
      "listings"."list_office_name" as "office", "listings"."is_company_listing" as "company",
      "listings"."from_feed" as "fromFeed"
    from top join ${listings} on "listings"."id" = top."id"
    order by ${order}
  `);
  return toPins(rows);
}

function toPins(rows: PinRow[]): MapPin[] {
  return rows
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      lat: r.lat!,
      lng: r.lng!,
      price: r.status === "closed" && r.closePrice ? r.closePrice : r.price,
      status: r.status,
      beds: r.beds,
      baths: r.baths,
      sqft: r.sqft,
      propertyType: r.propertyType,
      lotSqft: r.lotSqft,
      rent: r.transactionType === "rent",
      address: r.hideAddress
        ? r.city
        : `${r.addressLine1}${r.unitNumber ? ` #${r.unitNumber}` : ""}, ${r.city}`,
      photo: r.photo,
      featured: r.featured,
      office: r.office ?? (r.company ? site.legalName : null),
      fromFeed: r.fromFeed,
    }));
}
