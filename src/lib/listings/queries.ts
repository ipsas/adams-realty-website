import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  agents,
  dataSources,
  listingEvents,
  listingMedia,
  listings,
  openHouses,
  savedListings,
} from "@/db/schema";
import { cardColumns, selectCards, withPhotos } from "./card";

const LIVE_STATUSES = ["active", "coming_soon", "active_under_contract", "pending"] as const;

/** Full property page payload. `cache` dedupes the call between generateMetadata and the page. */
export const getListingBySlug = cache(async (slug: string) => {
  const [row] = await db
    .select({ listing: listings, source: dataSources })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .where(eq(listings.slug, slug))
    .limit(1);
  if (!row) return null;
  const { listing, source } = row;

  const [media, opens, events, agent] = await Promise.all([
    db
      .select()
      .from(listingMedia)
      .where(eq(listingMedia.listingId, listing.id))
      .orderBy(asc(listingMedia.sortOrder)),
    db
      .select()
      .from(openHouses)
      .where(and(eq(openHouses.listingId, listing.id), gt(openHouses.endsAt, new Date())))
      .orderBy(asc(openHouses.startsAt)),
    db
      .select()
      .from(listingEvents)
      .where(eq(listingEvents.listingId, listing.id))
      .orderBy(desc(listingEvents.occurredAt)),
    listing.listAgentId
      ? db
          .select()
          .from(agents)
          .where(eq(agents.id, listing.listAgentId))
          .limit(1)
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),
  ]);

  return {
    listing,
    source: {
      id: source.id,
      name: source.name,
      kind: source.kind,
      disclaimer: source.disclaimer,
      lastSyncedAt: source.lastSyncedAt,
    },
    media,
    openHouses: opens,
    events,
    agent,
  };
});

export type ListingDetail = NonNullable<Awaited<ReturnType<typeof getListingBySlug>>>;

/** Homepage row: featured company listings, topped up with the newest ones. */
export async function getFeaturedListings(limit = 8) {
  const rows = await selectCards(db)
    .where(
      and(
        isNull(listings.removedAt),
        eq(listings.status, "active"),
        eq(listings.transactionType, "sale"),
      ),
    )
    .orderBy(
      desc(listings.isFeatured),
      desc(listings.isCompanyListing),
      sql`${listings.listDate} desc nulls last`,
    )
    .limit(limit);
  return withPhotos(db, rows);
}

export async function getNewestListings(limit = 8) {
  const rows = await selectCards(db)
    .where(
      and(
        isNull(listings.removedAt),
        inArray(listings.status, ["active", "coming_soon"]),
        eq(listings.transactionType, "sale"),
      ),
    )
    .orderBy(sql`${listings.listDate} desc nulls last`)
    .limit(limit);
  return withPhotos(db, rows);
}

/** Same area and type, priced within ±25%, closest in price first. */
export async function getSimilarListings(l: typeof listings.$inferSelect, limit = 4) {
  const rows = await selectCards(db)
    .where(
      and(
        isNull(listings.removedAt),
        ne(listings.id, l.id),
        eq(listings.transactionType, l.transactionType),
        inArray(listings.status, ["active", "coming_soon"]),
        sql`${listings.listPrice} between ${Math.round(l.listPrice * 0.75)} and ${Math.round(l.listPrice * 1.25)}`,
        sql`(${listings.city} = ${l.city} or ${listings.neighborhood} = ${l.neighborhood ?? ""})`,
      ),
    )
    .orderBy(
      sql`(${listings.neighborhood} = ${l.neighborhood ?? ""}) desc`,
      sql`abs(${listings.listPrice} - ${l.listPrice})`,
    )
    .limit(limit);
  return withPhotos(db, rows);
}

export async function getAgentListings(agentId: string, limit = 12) {
  const rows = await selectCards(db)
    .where(
      and(
        isNull(listings.removedAt),
        eq(listings.listAgentId, agentId),
        inArray(listings.status, [...LIVE_STATUSES, "closed"]),
      ),
    )
    .orderBy(sql`${listings.status} = 'closed'`, sql`${listings.listDate} desc nulls last`)
    .limit(limit);
  return withPhotos(db, rows);
}

/** Saved homes, including ones that have since left the market (shown as unavailable). */
export async function getSavedListings(userId: string) {
  const rows = await db
    .select({ ...cardColumns, savedAt: savedListings.createdAt })
    .from(savedListings)
    .innerJoin(listings, eq(savedListings.listingId, listings.id))
    .where(eq(savedListings.userId, userId))
    .orderBy(desc(savedListings.createdAt));
  return withPhotos(db, rows);
}

export async function getSavedListingIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ id: savedListings.listingId })
    .from(savedListings)
    .where(eq(savedListings.userId, userId));
  return rows.map((r) => r.id);
}

export type Suggestion = {
  kind: "city" | "neighborhood" | "zip" | "address";
  label: string;
  sublabel?: string;
  /** Value for the search `q` param, or a slug for addresses. */
  value: string;
};

/** Location autocomplete: areas first, then matching addresses. */
export async function getLocationSuggestions(term: string): Promise<Suggestion[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const prefix = `${t.replace(/[%_\\]/g, "\\$&")}%`;
  const live = and(isNull(listings.removedAt), inArray(listings.status, [...LIVE_STATUSES]));

  const [areas, addresses] = await Promise.all([
    db.execute<{
      kind: "city" | "neighborhood" | "zip";
      label: string;
      sublabel: string | null;
      n: number;
    }>(sql`
      select kind, label, sublabel, count(*)::int as n from (
        select 'neighborhood' as kind, ${listings.neighborhood} as label, ${listings.city} as sublabel
          from ${listings} where ${live} and ${listings.neighborhood} ilike ${prefix}
        union all
        select 'city', ${listings.city}, ${listings.state} from ${listings} where ${live} and ${listings.city} ilike ${prefix}
        union all
        select 'zip', ${listings.postalCode}, ${listings.city} from ${listings} where ${live} and ${listings.postalCode} like ${prefix}
      ) s group by kind, label, sublabel order by n desc limit 6`),
    /^\d*\s*[a-z]/i.test(t) && t.length >= 3
      ? db
          .select({
            slug: listings.slug,
            addressLine1: listings.addressLine1,
            unitNumber: listings.unitNumber,
            city: listings.city,
            postalCode: listings.postalCode,
          })
          .from(listings)
          .where(
            and(
              live,
              eq(listings.hideAddress, false),
              sql`${listings.addressLine1} ilike ${"%" + t.replace(/[%_\\]/g, "\\$&") + "%"}`,
            ),
          )
          .orderBy(sql`similarity(${listings.addressLine1}, ${t}) desc`)
          .limit(5)
      : Promise.resolve([]),
  ]);

  return [
    ...areas.rows.map((a) => ({
      kind: a.kind,
      label: a.label,
      sublabel:
        a.kind === "zip"
          ? (a.sublabel ?? undefined)
          : a.kind === "neighborhood"
            ? `Neighborhood in ${a.sublabel}`
            : (a.sublabel ?? undefined),
      value: a.label,
    })),
    ...addresses.map((a) => ({
      kind: "address" as const,
      label: `${a.addressLine1}${a.unitNumber ? ` #${a.unitNumber}` : ""}`,
      sublabel: `${a.city}, ${a.postalCode}`,
      value: a.slug,
    })),
  ];
}

/**
 * Towns with the most active listings, for the homepage "Towns across…" grid.
 * Grouped by city: in a small-town and rural market the subdivision field is
 * often blank or "None", so it's no use as an area name.
 */
export async function getPopularAreas(limit = 8) {
  return db
    .select({
      city: listings.city,
      count: sql<number>`count(*)::int`,
      medianPrice: sql<number>`percentile_cont(0.5) within group (order by ${listings.listPrice})::int`,
      photo: sql<
        string | null
      >`(array_agg(${listings.primaryPhotoUrl} order by ${listings.isFeatured} desc, ${listings.listPrice} desc))[1]`,
    })
    .from(listings)
    .where(
      and(
        isNull(listings.removedAt),
        eq(listings.status, "active"),
        eq(listings.transactionType, "sale"),
      ),
    )
    .groupBy(listings.city)
    .orderBy(sql`count(*) desc`, listings.city)
    .limit(limit);
}

/** Headline numbers for the homepage. */
export async function getMarketStats() {
  const [row] = await db
    .select({
      active: sql<number>`count(*) filter (where ${listings.status} in ('active','coming_soon') and ${listings.transactionType} = 'sale')::int`,
      newThisWeek: sql<number>`count(*) filter (where ${listings.listDate} >= current_date - 7 and ${listings.transactionType} = 'sale')::int`,
      medianPrice: sql<number>`(percentile_cont(0.5) within group (order by ${listings.listPrice}) filter (where ${listings.status} = 'active' and ${listings.transactionType} = 'sale'))::int`,
      openHouses: sql<number>`(select count(distinct ${openHouses.listingId}) from ${openHouses} where ${openHouses.startsAt} > now() and ${openHouses.startsAt} < now() + interval '7 days')::int`,
    })
    .from(listings)
    .where(isNull(listings.removedAt));
  return row;
}
