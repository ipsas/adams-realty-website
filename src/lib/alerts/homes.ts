import { and, asc, eq, gt, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { listingEvents, listings, savedListings, users } from "@/db/schema";
import { alertListingColumns } from "./queries";
import type { HomeEvent } from "./present";
import { alertWindows, CLAIM_LEASE_MS, EVENT_SETTLE_MS, inWindow, MAX_WINDOW_MS } from "./schedule";

/** Changes to a saved home worth an email. ("listed" predates the save; "removed" hides the home.) */
export const HOME_EVENT_TYPES = ["price_change", "status_change", "sold", "relisted"] as const;

/**
 * Saved homes with at least one change inside their own event window, for
 * users with saved-home alerts on. The window start mirrors
 * `alertWindows().events.start` for a saved_listings row, in SQL.
 */
export async function findHomeCandidates(db: Executor, now: Date) {
  const floor = new Date(now.getTime() - MAX_WINDOW_MS);
  const eventsEnd = new Date(now.getTime() - EVENT_SETTLE_MS);
  const lease = new Date(now.getTime() - CLAIM_LEASE_MS);
  const windowStart = sql`greatest(
    ${savedListings.createdAt},
    coalesce(${savedListings.lastNotifiedAt}, ${savedListings.createdAt}) - ${`${EVENT_SETTLE_MS / 1000} seconds`}::interval,
    ${floor.toISOString()}::timestamptz
  )`;
  return db
    .select({
      userId: savedListings.userId,
      listingId: savedListings.listingId,
      email: users.email,
    })
    .from(savedListings)
    .innerJoin(users, eq(users.id, savedListings.userId))
    .innerJoin(listings, eq(listings.id, savedListings.listingId))
    .where(
      and(
        eq(users.homeAlerts, true),
        isNull(listings.removedAt),
        or(isNull(savedListings.lastNotifiedAt), lt(savedListings.lastNotifiedAt, lease)),
        sql`exists (
          select 1 from ${listingEvents}
          where ${listingEvents.listingId} = ${savedListings.listingId}
            and ${inArray(listingEvents.type, [...HOME_EVENT_TYPES])}
            and ${listingEvents.occurredAt} > ${windowStart}
            and ${listingEvents.occurredAt} <= ${eventsEnd.toISOString()}::timestamptz
        )`,
      ),
    );
}

export type ClaimedHome = { listingId: string; createdAt: Date; previous: Date | null };

/**
 * Advances `last_notified_at` to `now` on these saved homes and returns the
 * previous values — atomically, and only for rows no other run touched within
 * CLAIM_LEASE_MS, so two overlapping runs can't both email about a change.
 */
export async function claimHomes(
  db: Executor,
  userId: string,
  listingIds: string[],
  now: Date,
): Promise<ClaimedHome[]> {
  if (!listingIds.length) return [];
  const lease = new Date(now.getTime() - CLAIM_LEASE_MS);
  const ids = sql.join(
    listingIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const res = await db.execute<{ listing_id: string; created_at: Date; previous: Date | null }>(sql`
    update saved_listings sl set last_notified_at = ${now.toISOString()}::timestamptz
    from (
      select user_id, listing_id, last_notified_at from saved_listings
      where user_id = ${userId} and listing_id in (${ids})
      for update
    ) prev
    where sl.user_id = prev.user_id and sl.listing_id = prev.listing_id
      and (sl.last_notified_at is null or sl.last_notified_at < ${lease.toISOString()}::timestamptz)
    returning sl.listing_id, sl.created_at, prev.last_notified_at as previous`);
  return res.rows.map((r) => ({
    listingId: r.listing_id,
    createdAt: new Date(r.created_at),
    previous: r.previous ? new Date(r.previous) : null,
  }));
}

/** Undoes `claimHomes` after a failed send, so the next run tries again. */
export async function releaseHomes(
  db: Executor,
  userId: string,
  claimed: ClaimedHome[],
  now: Date,
): Promise<void> {
  for (const c of claimed) {
    await db.execute(sql`
      update saved_listings set last_notified_at = ${c.previous?.toISOString() ?? null}::timestamptz
      where user_id = ${userId} and listing_id = ${c.listingId}::uuid
        and last_notified_at = ${now.toISOString()}::timestamptz`);
  }
}

/** Each claimed home's listing plus the events inside its own window, oldest first. */
export async function loadHomeChanges(db: Executor, claimed: ClaimedHome[], now: Date) {
  if (!claimed.length) return [];
  const windows = new Map(
    claimed.map((c) => [
      c.listingId,
      alertWindows({ createdAt: c.createdAt, lastRunAt: c.previous, now }).events,
    ]),
  );
  const earliest = new Date(Math.min(...[...windows.values()].map((w) => w.start.getTime())));
  const ids = claimed.map((c) => c.listingId);

  const [rows, events] = await Promise.all([
    db
      .select(alertListingColumns)
      .from(listings)
      .where(and(inArray(listings.id, ids), isNull(listings.removedAt))),
    db
      .select({
        listingId: listingEvents.listingId,
        type: listingEvents.type,
        occurredAt: listingEvents.occurredAt,
        price: listingEvents.price,
        previousPrice: listingEvents.previousPrice,
        fromStatus: listingEvents.fromStatus,
        toStatus: listingEvents.toStatus,
      })
      .from(listingEvents)
      .where(
        and(
          inArray(listingEvents.listingId, ids),
          inArray(listingEvents.type, [...HOME_EVENT_TYPES]),
          gt(listingEvents.occurredAt, earliest),
          lte(listingEvents.occurredAt, new Date(now.getTime() - EVENT_SETTLE_MS)),
        ),
      )
      .orderBy(asc(listingEvents.occurredAt), asc(listingEvents.id)),
  ]);

  return rows.map((listing) => ({
    listing,
    events: events.filter(
      (e): boolean =>
        e.listingId === listing.id && inWindow(e.occurredAt, windows.get(listing.id)!),
    ) satisfies HomeEvent[],
  }));
}
