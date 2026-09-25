import { and, eq, inArray, isNull, or, sql, gte, type SQL } from "drizzle-orm";
import { listings } from "@/db/schema";
import type { PurgeScope } from "./types";

/**
 * Purge scope and SQL, kept free of the database client so tests can render
 * the statements. The purge compares the feed's keys against the listings the
 * site keeps showing (see `PurgeScope`); older closed sales and off-market
 * rows are out of scope and never touched.
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

/** The scope for a purge run at `now` (dates in UTC, like sold mode's window). */
export function purgeScope(now: Date): PurgeScope {
  const since = new Date(now.getTime() - PURGE_SOLD_DAYS * 86_400_000);
  return { closedSince: since.toISOString().slice(0, 10) };
}

/** Most listings a purge may remove from `inScope` without `allowLargePurge`. */
export function purgeCap(inScope: number): number {
  return Math.max(MIN_PURGE_CAP, Math.floor(inScope * MAX_PURGE_FRACTION));
}

/** A source's listings that a purge compares against the feed. */
export function inPurgeScope(sourceId: string, scope: PurgeScope): SQL {
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
