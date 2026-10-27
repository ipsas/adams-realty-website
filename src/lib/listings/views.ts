import { and, asc, between, eq, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { listingViews, listings } from "@/db/schema";
import { addDays, marketToday } from "@/lib/areas/stats";

/**
 * Listing page views, kept so traffic statistics can be shared with Georgia
 * MLS on request (IDX agreement, Exhibit A §9). One counter per listing per
 * market-calendar day.
 */

/** Crawlers, link previewers and HTTP libraries: their page loads aren't views. */
const BOT_UA =
  /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|lighthouse|python|curl|wget|httpclient|okhttp|node-fetch|axios|go-http-client|java\//i;

export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !ua || BOT_UA.test(ua);
}

/** Adds one view of `listingId` on the market's current day. */
export async function recordListingView(
  db: Executor,
  listingId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .insert(listingViews)
    .values({ listingId, day: marketToday(now), views: 1 })
    .onConflictDoUpdate({
      target: [listingViews.listingId, listingViews.day],
      set: { views: sql`${listingViews.views} + 1` },
    });
}

export type ListingViewRow = {
  listingId: string;
  mlsNumber: string | null;
  slug: string;
  address: string;
  city: string;
  fromFeed: boolean;
  listOfficeName: string | null;
  /** For listingOfficeLabel when the feed sends no office name. */
  listOfficeMlsId: string | null;
  isCompanyListing: boolean;
  views: number;
};

/**
 * Views per listing between two market dates (inclusive), busiest first.
 * `feedOnly` keeps the Georgia MLS listings, the ones the statistics are owed on.
 */
export async function getListingViews(
  db: Executor,
  range: { from: string; to: string },
  opts: { feedOnly?: boolean; limit?: number } = {},
): Promise<ListingViewRow[]> {
  const views = sql<number>`sum(${listingViews.views})::int`;
  const q = db
    .select({
      listingId: listings.id,
      mlsNumber: listings.mlsNumber,
      slug: listings.slug,
      address: listings.addressLine1,
      city: listings.city,
      fromFeed: listings.fromFeed,
      listOfficeName: listings.listOfficeName,
      listOfficeMlsId: listings.listOfficeMlsId,
      isCompanyListing: listings.isCompanyListing,
      views,
    })
    .from(listingViews)
    .innerJoin(listings, eq(listings.id, listingViews.listingId))
    .where(
      and(
        between(listingViews.day, range.from, range.to),
        opts.feedOnly ? eq(listings.fromFeed, true) : undefined,
      ),
    )
    .groupBy(listings.id)
    .orderBy(sql`${views} desc`, asc(listings.id));
  return opts.limit ? q.limit(opts.limit) : q;
}

/** Views per market day between two dates (inclusive), for the dashboard's totals. */
export async function getDailyViewTotals(
  db: Executor,
  range: { from: string; to: string },
): Promise<{ day: string; views: number; listings: number }[]> {
  return db
    .select({
      day: listingViews.day,
      views: sql<number>`sum(${listingViews.views})::int`,
      listings: sql<number>`count(*)::int`,
    })
    .from(listingViews)
    .where(between(listingViews.day, range.from, range.to))
    .groupBy(listingViews.day)
    .orderBy(asc(listingViews.day));
}

export type ViewRange = { from: string; to: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 366;

/**
 * The date range for the traffic page and its CSV export, from `?from=&to=`
 * (market dates, inclusive). Defaults to the last 30 days; a reversed range is
 * swapped and a range longer than a year is cut to its last year.
 */
export function parseViewRange(
  params: { from?: string | string[] | null; to?: string | string[] | null },
  now: Date = new Date(),
): ViewRange {
  const today = marketToday(now);
  const valid = (v: unknown) =>
    typeof v === "string" && ISO_DATE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`))
      ? v
      : null;
  let to = valid(params.to) ?? today;
  let from = valid(params.from) ?? addDays(to, -29);
  if (from > to) [from, to] = [to, from];
  const earliest = addDays(to, -(MAX_RANGE_DAYS - 1));
  if (from < earliest) from = earliest;
  return { from, to };
}
