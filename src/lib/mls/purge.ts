import { and, eq, inArray, isNull, lt, or, sql, gte, type SQL } from "drizzle-orm";
import { site } from "@/config/site";
import { inquiries, listings, savedListings } from "@/db/schema";
import type { PurgeScope } from "./types";

/**
 * Purge scope and SQL, kept free of the database client so tests can render
 * the statements. The purge compares the feed's keys against the listings the
 * site keeps showing (see `PurgeScope`); older closed sales and off-market
 * rows are out of scope and never touched.
 *
 * A live-only source (`DataSourceConfig.liveOnly`, e.g. Georgia MLS) is
 * different: its feed only ever sends live statuses, so a listing that closed
 * simply stops arriving and its row still reads active. Every stored row of
 * the source not yet removed is then in scope, whatever its status, and goes
 * once its key is missing from the kept keys: the feed's live keys plus the
 * firm's own sales (list office in `companyOfficeIds`) closed within
 * PURGE_SOLD_DAYS, fetched by their own query (`ListingProvider.ownClosed`;
 * the sync also refreshes those rows, OWN_CLOSED_INTERVAL_MS in
 * sync-engine.ts). Other offices' closed sales are never kept, and an own sale
 * that ages past the window is purged like any missing key. Both key lists
 * must download in full, or nothing is removed.
 *
 * The first purge after switching an existing database to the live-only feed
 * will usually exceed the 5% cap: it takes down every stored closed row at
 * once. Run it once with `npm run mls:sync -- --purge --allow-large-purge`
 * (or the cron route with `&allowLargePurge=1`). A fresh database is not
 * affected.
 *
 * Removed rows are hard-deleted PRUNE_REMOVED_AFTER_DAYS later (`pruneRemovedWhere`).
 */

/** Statuses a purge keeps when the feed still has them. */
export const PURGE_LIVE_STATUSES = [
  "active",
  "coming_soon",
  "active_under_contract",
  "pending",
] as const;

/**
 * Closed sales stay in scope this long: sold mode's default window
 * (`DEFAULT_SOLD_WINDOW_DAYS` in src/lib/search/query.ts), which also covers
 * the area guides' 180-day sales stats.
 */
export const PURGE_SOLD_DAYS = 365;

/** A purge may remove at most this share of the in-scope listings without an override… */
export const MAX_PURGE_FRACTION = 0.05;
/** …but never fewer than this many, so a small feed's normal churn doesn't trip it. */
export const MIN_PURGE_CAP = 25;

/**
 * The purge runs daily. With no successful purge for this long (counted from
 * the source's first run while it has never purged), off-market listings may
 * be showing, which IDX rules forbid: the dashboard says so.
 */
export const PURGE_OVERDUE_MS = 36 * 3_600_000;

export function purgeOverdue(
  runs: { firstRunAt: Date | null; lastPurgeAt: Date | null },
  now: Date,
): boolean {
  const since = runs.lastPurgeAt ?? runs.firstRunAt;
  return since !== null && now.getTime() - since.getTime() > PURGE_OVERDUE_MS;
}

/**
 * The scope for a purge run at `now`. `closedSince` is the market's calendar
 * date (America/New_York, `site.market.timeZone`) PURGE_SOLD_DAYS days ago, so
 * the window is exactly that many local days, whatever the UTC date or DST.
 * `liveOnly`: the source's feed only sends live statuses (`DataSourceConfig.liveOnly`).
 */
export function purgeScope(now: Date, opts: { liveOnly?: boolean } = {}): PurgeScope {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: site.market.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Calendar math on the local date, at UTC midnight: no DST in it.
  const today = Date.UTC(part("year"), part("month") - 1, part("day"));
  const closedSince = new Date(today - PURGE_SOLD_DAYS * 86_400_000).toISOString().slice(0, 10);
  return opts.liveOnly ? { closedSince, liveOnly: true } : { closedSince };
}

/** Most listings a purge may remove from `inScope` without `allowLargePurge`. */
export function purgeCap(inScope: number): number {
  return Math.max(MIN_PURGE_CAP, Math.floor(inScope * MAX_PURGE_FRACTION));
}

/**
 * A source's listings that a purge compares against the feed. Live-only: every
 * row not yet removed, whatever its status (a listing that closed stopped
 * arriving, so it still reads active; older closed or withdrawn rows predate
 * the filter).
 */
export function inPurgeScope(sourceId: string, scope: PurgeScope): SQL {
  if (scope.liveOnly) return and(eq(listings.sourceId, sourceId), isNull(listings.removedAt))!;
  return and(
    eq(listings.sourceId, sourceId),
    isNull(listings.removedAt),
    or(
      inArray(listings.status, [...PURGE_LIVE_STATUSES]),
      and(eq(listings.status, "closed"), gte(listings.closeDate, scope.closedSince)),
    ),
  )!;
}

/**
 * True for a listing whose key is not among `feedKeys`. The keys travel as
 * ONE array parameter, anti-joined through `unnest` (a hash anti join), so any
 * number of keys works: one bind parameter per key overflows Postgres's
 * 65,535-parameter limit at a statewide feed's ~70k keys.
 */
export function missingFromFeed(feedKeys: string[]): SQL {
  // Qualified by hand: Drizzle renders column refs unqualified inside select fields.
  return sql`not exists (select 1 from unnest(${sql.param(feedKeys)}::text[]) as feed(key) where feed.key = "listings"."listing_key")`;
}

/**
 * How many listings are in scope, and how many of those the feed no longer
 * has: one pass, the keys hash-joined as one array parameter. (A NOT EXISTS
 * inside the count's FILTER would run once per row: minutes at 200k rows.)
 */
export function purgeCountQuery(sourceId: string, feedKeys: string[], scope: PurgeScope): SQL {
  return sql`select count(*)::int as "inScope", (count(*) filter (where feed.key is null))::int as "missing"
    from ${listings}
    left join unnest(${sql.param(feedKeys)}::text[]) as feed(key) on feed.key = "listings"."listing_key"
    where ${inPurgeScope(sourceId, scope)}`;
}

/** The purge's WHERE clause: in-scope listings of `sourceId` whose key the feed no longer has. */
export function purgeWhere(sourceId: string, feedKeys: string[], scope: PurgeScope): SQL {
  return and(inPurgeScope(sourceId, scope), missingFromFeed(feedKeys))!;
}

/**
 * Removed listings are deleted for good this long after their removal. The
 * purge only sets `removedAt`, and a statewide feed sheds ~16k listings a
 * month, so without pruning the soft-deleted rows would pile up.
 */
export const PRUNE_REMOVED_AFTER_DAYS = 7;

/**
 * Listings of `sourceId` removed before `before` that nothing still points
 * at. A lead (inquiries, set null on delete) or a user's saved home
 * (saved_listings, cascade) keeps its listing, so neither loses it. Media,
 * open houses, listing events and daily views cascade with the delete.
 */
export function pruneRemovedWhere(sourceId: string, before: Date): SQL {
  return and(
    eq(listings.sourceId, sourceId),
    lt(listings.removedAt, before),
    // Qualified by hand, like missingFromFeed.
    sql`not exists (select 1 from ${inquiries} where ${inquiries.listingId} = "listings"."id")`,
    sql`not exists (select 1 from ${savedListings} where ${savedListings.listingId} = "listings"."id")`,
  )!;
}
