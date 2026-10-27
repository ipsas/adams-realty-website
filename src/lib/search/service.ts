import { count, sql, type SQL } from "drizzle-orm";
import { db, type Executor } from "@/db";
import { site } from "@/config/site";
import { listings } from "@/db/schema";
import { formatStreet } from "@/lib/format";
import { listingContact } from "@/lib/listings/attribution-contact";
import {
  officeLookupName,
  selectCards,
  withPhotos,
  type ListingCardData,
} from "@/lib/listings/card";
import { listingOfficeLabel } from "@/lib/listings/office-label";
import { PAGE_SIZE, type SearchCriteria } from "./params";
import { resolveScope } from "./place";
import { buildOrderBy, buildWhere, hasLocation, type LocationScope } from "./query";

/**
 * Search entry points. Backed by Postgres (full-text + GiST geo index), which
 * comfortably handles a metro MLS (~50–100k listings). If we outgrow it, swap
 * the implementation of these two functions for Typesense/OpenSearch — the
 * rest of the app only depends on these signatures.
 */

/**
 * The longest a public search statement may run (`statement_timeout`): any visitor's
 * URL can ask for an expensive search. Generous because Neon runs 2-5x slower than a
 * local box. Past it the page shows what came back and says it may be incomplete,
 * instead of hanging or failing. Mutable
 * only so a db test can shorten it.
 */
export const SEARCH_LIMITS = { statementTimeout: "5s" };

/** Postgres's query_canceled: the statement hit `statement_timeout`. */
const QUERY_CANCELED = "57014";

/**
 * One page request's searches. The first timeout is recorded here; after it, every
 * later search query gives its fallback without taking a pool connection, so a slow
 * search can't hold more connections while the page is already incomplete.
 */
export type SearchRun = { timedOut: boolean };

export const searchRun = (): SearchRun => ({ timedOut: false });

/** Whether `e` is a statement timeout: on the error, or on drizzle's wrapper as `cause`. */
function isTimeout(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } };
  return err?.code === QUERY_CANCELED || err?.cause?.code === QUERY_CANCELED;
}

/** One log line, never the search itself. */
function timedOut(run: SearchRun, kind: "results" | "count" | "pins") {
  run.timedOut = true;
  console.warn(`[search] timeout kind=${kind}`);
}

/**
 * `query` in a transaction whose statements stop after `SEARCH_LIMITS.statementTimeout`;
 * on that timeout, `fallback`, recorded on `run`. Nothing here is cached, so a timed-out
 * result isn't kept. Any other error is thrown.
 */
async function bounded<T>(
  run: SearchRun,
  kind: "results" | "count" | "pins",
  fallback: T,
  query: (tx: Executor) => Promise<T>,
): Promise<T> {
  if (run.timedOut) return fallback;
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(
        sql.raw(`set local statement_timeout = '${SEARCH_LIMITS.statementTimeout}'`),
      );
      return query(tx);
    });
  } catch (e) {
    if (!isTimeout(e)) throw e;
    timedOut(run, kind);
    return fallback;
  }
}

async function countWhere(ex: Executor, where: SQL | undefined): Promise<number> {
  const [{ total }] = await ex.select({ total: count() }).from(listings).where(where);
  return total;
}

export type SearchResult = {
  items: ListingCardData[];
  /** Null when the count timed out (or wasn't run): unknown, never a guess. */
  total: number | null;
  page: number;
  pageCount: number;
  /** The results or the count timed out: `items` may be short, `total` unknown. */
  incomplete: boolean;
};

/**
 * `scope` is whether `q` names a town (./place.ts); callers that already know
 * pass it, else it's looked up. `run` is the page request's (`searchRun`).
 */
export async function searchListings(
  c: SearchCriteria,
  scope?: LocationScope,
  run: SearchRun = searchRun(),
): Promise<SearchResult> {
  const where = buildWhere(c, undefined, scope ?? (await resolveScope(db, c)));
  const offset = (c.page - 1) * PAGE_SIZE;
  // Results, then the count, on one connection: a timed-out page of results skips the count.
  const { items, total } = await bounded(
    run,
    "results",
    { items: [] as ListingCardData[], total: null as number | null },
    async (tx) => {
      const items = await withPhotos(
        tx,
        await selectCards(tx)
          .where(where)
          .orderBy(...buildOrderBy(c))
          .limit(PAGE_SIZE)
          .offset(offset),
      );
      if (run.timedOut) return { items, total: null };
      try {
        // In a savepoint, so a timed-out count leaves the transaction (and the results) usable.
        return { items, total: await tx.transaction((sp) => countWhere(sp, where)) };
      } catch (e) {
        if (!isTimeout(e)) throw e;
        timedOut(run, "count");
        return { items, total: null };
      }
    },
  );
  return {
    items,
    total,
    page: c.page,
    // Unknown total: no page count to page or redirect by.
    pageCount: total === null ? c.page : Math.max(1, Math.ceil(total / PAGE_SIZE)),
    incomplete: total === null,
  };
}

/** How many listings match `c` (no page of results); null on a timeout. */
export async function countListings(
  c: SearchCriteria,
  scope?: LocationScope,
  run: SearchRun = searchRun(),
): Promise<number | null> {
  const where = buildWhere(c, undefined, scope ?? (await resolveScope(db, c)));
  return bounded(run, "count", null, (tx) => countWhere(tx, where));
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
  /** IDX: the listing's own attribution contact, shown after the listing firm. */
  attributionPhone: string | null;
  attributionEmail: string | null;
  /** The firm's own listing: its attribution contact falls back to the office (listingContact). */
  company: boolean;
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
 *
 * A timeout gives no pins; the caller learns it from `run.timedOut`.
 */
export async function searchMapPins(
  c: SearchCriteria,
  scope?: LocationScope,
  run: SearchRun = searchRun(),
): Promise<MapPin[]> {
  const resolved = scope ?? (await resolveScope(db, c));
  return bounded(run, "pins", [], async (tx) => {
    if (hasLocation(c)) {
      // One after the other: a transaction's statements share its one connection.
      const matches = await estimateRows(tx, buildWhere(c, undefined, resolved));
      const inScope = await estimateRows(tx, buildWhere({ ...c, q: undefined }));
      if (!walkPins(matches, inScope)) return locationPins(c, MAX_PINS, resolved, tx);
    }
    return walkedPins(tx, c, resolved);
  });
}

/** The first MAX_PINS matches, walked off the order index. */
async function walkedPins(
  ex: Executor,
  c: SearchCriteria,
  resolved: LocationScope,
): Promise<MapPin[]> {
  const rows = await ex
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
      listOfficeMlsId: listings.listOfficeMlsId,
      officeLookupName: officeLookupName(),
      attributionPhone: listings.attributionPhone,
      attributionEmail: listings.attributionEmail,
      listAgentId: listings.listAgentId,
      listAgentMlsId: sql<string | null>`(
        select a.mls_agent_id from agents a where a.id = "listings"."list_agent_id"
      )`,
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
async function estimateRows(ex: Executor, where: SQL | undefined): Promise<number> {
  const { rows } = await ex.execute<{ "QUERY PLAN": [{ Plan: { "Plan Rows": number } }] }>(
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
  listOfficeMlsId?: string | null;
  officeLookupName?: string | null;
  attributionPhone: string | null;
  attributionEmail: string | null;
  listAgentId: string | null;
  listAgentMlsId: string | null;
  company: boolean;
  fromFeed: boolean;
};

/**
 * The first `limit` matches in the search's order, collected rather than
 * walked: the matches come from the location indexes (a bitmap), the first
 * `limit` are picked from them, and only those are read in full. Exported for
 * tests; `searchMapPins` decides when to use it, and passes its bounded transaction.
 */
export async function locationPins(
  c: SearchCriteria,
  limit: number = MAX_PINS,
  scope?: LocationScope,
  ex: Executor = db,
): Promise<MapPin[]> {
  const where = buildWhere(c, undefined, scope ?? (await resolveScope(ex, c)));
  const order = sql.join(buildOrderBy(c), sql`, `);
  // buildOrderBy's column refs are qualified with "listings": the CTE rows
  // are aliased to that name so the same ORDER BY applies to them.
  const { rows } = await ex.execute<PinRow>(sql`
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
      "listings"."list_office_mls_id" as "listOfficeMlsId",
      ${officeLookupName()} as "officeLookupName",
      "listings"."attribution_phone" as "attributionPhone",
      "listings"."attribution_email" as "attributionEmail",
      "listings"."list_agent_id" as "listAgentId",
      (select a.mls_agent_id from agents a where a.id = "listings"."list_agent_id") as "listAgentMlsId",
      "listings"."from_feed" as "fromFeed"
    from top join ${listings} on "listings"."id" = top."id"
    order by ${order}
  `);
  return toPins(rows);
}

/** Exported for tests. */
export function toPins(rows: PinRow[]): MapPin[] {
  return rows
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => {
      const contact = listingContact({ ...r, isCompanyListing: r.company });
      return {
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
        address: r.hideAddress ? r.city : `${formatStreet(r)}, ${r.city}`,
        photo: r.photo,
        featured: r.featured,
        office: listingOfficeLabel(
          {
            listOfficeName: r.office,
            listOfficeMlsId: r.listOfficeMlsId,
            officeLookupName: r.officeLookupName,
            isCompanyListing: r.company,
            fromFeed: r.fromFeed,
          },
          site,
        ),
        attributionPhone: contact.phone,
        attributionEmail: contact.email,
        company: r.company,
        fromFeed: r.fromFeed,
      };
    });
}
