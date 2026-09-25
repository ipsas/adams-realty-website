import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { dataSources, listingEvents, listings } from "@/db/schema";
import { buildWhere } from "@/lib/search/query";
import type { SearchCriteria } from "@/lib/search/params";
import type { AlertListing } from "./present";
import type { Window } from "./schedule";

/** Columns for an alert email row (`AlertListing` in present.ts) plus the source, for disclaimers. */
export const alertListingColumns = {
  id: listings.id,
  sourceId: listings.sourceId,
  slug: listings.slug,
  status: listings.status,
  transactionType: listings.transactionType,
  listPrice: listings.listPrice,
  closePrice: listings.closePrice,
  bedrooms: listings.bedrooms,
  bathrooms: listings.bathrooms,
  livingAreaSqft: listings.livingAreaSqft,
  addressLine1: listings.addressLine1,
  unitNumber: listings.unitNumber,
  city: listings.city,
  state: listings.state,
  postalCode: listings.postalCode,
  hideAddress: listings.hideAddress,
  primaryPhotoUrl: listings.primaryPhotoUrl,
  listOfficeName: listings.listOfficeName,
  isCompanyListing: listings.isCompanyListing,
};

/** Most listings one alert email shows; the rest are a "see all" link away. */
export const MAX_ROWS = 10;

/**
 * A listing counts as "new" when we first recorded it inside the window *and*
 * it went on the market recently. The second rule keeps a first MLS import
 * (or a feed re-send) of months-old listings from emailing everyone.
 */
const NEW_LISTING_MAX_AGE_DAYS = 7;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

export type MatchRow = AlertListing & {
  sourceId: string;
  /** Highest pre-cut price in the event window, when the home had a price cut. */
  wasPrice: number | null;
  /** Total matches for the query (`count(*) over ()`), before the row limit. */
  total: number;
};

export type SearchMatches = {
  /** New listings — or, for "sold" searches, newly sold homes. */
  newRows: MatchRow[];
  newTotal: number;
  cutRows: MatchRow[];
  cutTotal: number;
};

/**
 * Homes matching a saved search's criteria (map bounds included) that are
 * new in `win.listings`, plus homes that already matched and had a price cut
 * in `win.events`. Each list is capped at MAX_ROWS, with exact totals.
 */
export async function findSearchMatches(
  db: Executor,
  criteria: SearchCriteria,
  win: { listings: Window; events: Window },
  now: Date,
): Promise<SearchMatches> {
  const matches = buildWhere(criteria, now);
  const total = sql<number>`count(*) over ()`.mapWith(Number);
  const inEvents = (type: "price_change" | "sold") =>
    and(
      eq(listingEvents.type, type),
      gt(listingEvents.occurredAt, win.events.start),
      lte(listingEvents.occurredAt, win.events.end),
    );

  if (criteria.mode === "sold") {
    const sold = db
      .select({
        listingId: listingEvents.listingId,
        soldAt: sql<Date>`max(${listingEvents.occurredAt})`.as("sold_at"),
      })
      .from(listingEvents)
      .where(inEvents("sold"))
      .groupBy(listingEvents.listingId)
      .as("sold");
    const rows = await db
      .select({ ...alertListingColumns, wasPrice: sql<number | null>`null`, total })
      .from(listings)
      .innerJoin(sold, eq(sold.listingId, listings.id))
      .where(matches)
      .orderBy(desc(sold.soldAt), asc(listings.id))
      .limit(MAX_ROWS);
    return { newRows: rows, newTotal: rows[0]?.total ?? 0, cutRows: [], cutTotal: 0 };
  }

  const cuts = db
    .select({
      listingId: listingEvents.listingId,
      wasPrice: sql<number>`max(${listingEvents.previousPrice})`.as("was_price"),
    })
    .from(listingEvents)
    .where(
      and(inEvents("price_change"), sql`${listingEvents.price} < ${listingEvents.previousPrice}`),
    )
    .groupBy(listingEvents.listingId)
    .as("cuts");

  const oldestListDate = isoDate(
    new Date(win.listings.start.getTime() - NEW_LISTING_MAX_AGE_DAYS * 86_400_000),
  );
  const [newRows, cutRows] = await Promise.all([
    db
      .select({ ...alertListingColumns, wasPrice: cuts.wasPrice, total })
      .from(listings)
      .leftJoin(cuts, eq(cuts.listingId, listings.id))
      .where(
        and(
          matches,
          gt(listings.createdAt, win.listings.start),
          lte(listings.createdAt, win.listings.end),
          or(isNull(listings.listDate), gte(listings.listDate, oldestListDate)),
        ),
      )
      .orderBy(desc(listings.createdAt), asc(listings.id))
      .limit(MAX_ROWS),
    db
      .select({ ...alertListingColumns, wasPrice: cuts.wasPrice, total })
      .from(listings)
      .innerJoin(cuts, eq(cuts.listingId, listings.id))
      .where(
        and(
          matches,
          // Homes new in this window are already in the first list.
          lte(listings.createdAt, win.listings.start),
          sql`${cuts.wasPrice} > ${listings.listPrice}`,
        ),
      )
      .orderBy(desc(sql`${cuts.wasPrice} - ${listings.listPrice}`), asc(listings.id))
      .limit(MAX_ROWS),
  ]);
  return {
    newRows,
    newTotal: newRows[0]?.total ?? 0,
    cutRows,
    cutTotal: cutRows[0]?.total ?? 0,
  };
}

/** IDX disclaimers for the feeds the given listings came from. */
export async function disclaimersFor(db: Executor, sourceIds: string[]): Promise<string[]> {
  const ids = [...new Set(sourceIds)];
  if (!ids.length) return [];
  const rows = await db
    .selectDistinct({ text: dataSources.disclaimer })
    .from(dataSources)
    .where(and(inArray(dataSources.id, ids), isNotNull(dataSources.disclaimer)));
  return rows.map((r) => r.text!).filter(Boolean);
}
