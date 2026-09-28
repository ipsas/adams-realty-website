import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import {
  agents,
  dataSources,
  listingEvents,
  listingMedia,
  listings,
  openHouses,
  places,
  savedListings,
} from "@/db/schema";
import { firmAreaCondition } from "@/lib/areas/firm-area";
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

/** The home page shows "Handpicked by our agents" only with at least this many homes. */
export const FEATURED_MIN = 4;

/**
 * Home page "Handpicked by our agents": featured and company listings first,
 * topped up with the newest homes. Only the firm's own listings and homes in
 * its area qualify (`firmAreaCondition`), so a statewide feed never puts
 * another brokerage's Savannah home under our agents' name. The home page
 * hides the section when fewer than FEATURED_MIN qualify.
 */
export async function getFeaturedListings(limit = 8) {
  const rows = await selectCards(db)
    .where(
      and(
        isNull(listings.removedAt),
        eq(listings.status, "active"),
        eq(listings.transactionType, "sale"),
        or(eq(listings.isCompanyListing, true), firmAreaCondition()),
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
  /** Live listings in the place (not for addresses). */
  count?: number;
};

/**
 * Location autocomplete: areas first, then matching addresses. Area names and
 * counts come from the `places` materialized view (rebuilt after each sync,
 * seed and dashboard listing change; see refreshPlaces), so a keystroke reads
 * a few index entries instead of every live listing sharing the prefix.
 */
export async function getLocationSuggestions(term: string): Promise<Suggestion[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const escaped = t.replace(/[%_\\]/g, "\\$&");
  const live = and(isNull(listings.removedAt), inArray(listings.status, [...LIVE_STATUSES]));

  const [areas, addresses] = await Promise.all([
    db
      .select({ kind: places.kind, label: places.label, sublabel: places.sublabel, n: places.n })
      .from(places)
      .where(sql`lower(${places.label}) like ${`${escaped.toLowerCase()}%`}`)
      .orderBy(desc(places.n), asc(places.label))
      .limit(6),
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
              sql`${listings.addressLine1} ilike ${"%" + escaped + "%"}`,
            ),
          )
          .orderBy(sql`similarity(${listings.addressLine1}, ${t}) desc`)
          .limit(5)
      : Promise.resolve([]),
  ]);

  return [
    ...areas.map((a) => ({
      kind: a.kind,
      label: a.label,
      sublabel:
        a.kind === "zip"
          ? (a.sublabel ?? undefined)
          : a.kind === "neighborhood"
            ? `Neighborhood in ${a.sublabel}`
            : (a.sublabel ?? undefined),
      value: a.label,
      count: a.n,
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

/** The for-sale set the default /homes search shows (and `listings_buy_*` indexes cover). */
const forSaleNow = () =>
  and(
    isNull(listings.removedAt),
    eq(listings.transactionType, "sale"),
    inArray(listings.status, ["active", "coming_soon"]),
  );

export type CityCount = { city: string; count: number };

/**
 * The cities with the most homes for sale, busiest first: the home page's
 * town chips, computed from the feed rather than a hard-coded list. Each
 * links to `/homes?q=<city>`. Changes only when the feed does, so callers
 * cache it with the other home-page stats.
 */
export async function getTopCities(limit = 12): Promise<CityCount[]> {
  return db
    .select({ city: listings.city, count: sql<number>`count(*)::int` })
    .from(listings)
    .where(forSaleNow())
    .groupBy(listings.city)
    .orderBy(sql`count(*) desc`, listings.city)
    .limit(limit);
}

export type PlacesIndexCounty = {
  /** County name as the feed spells it; null collects listings with no county. */
  county: string | null;
  cities: CityCount[];
};

/**
 * Every city with homes for sale, grouped by county (A–Z, no-county last) and
 * alphabetical within it: the statewide "See all towns" index. A city that
 * spans counties appears under each, with that county's count.
 */
export async function getPlacesIndex(): Promise<PlacesIndexCounty[]> {
  const rows = await db
    .select({
      county: listings.county,
      city: listings.city,
      count: sql<number>`count(*)::int`,
    })
    .from(listings)
    .where(forSaleNow())
    .groupBy(listings.county, listings.city)
    .orderBy(sql`${listings.county} asc nulls last`, listings.city);
  const out: PlacesIndexCounty[] = [];
  for (const r of rows) {
    const last = out.at(-1);
    if (last && last.county === r.county) last.cities.push({ city: r.city, count: r.count });
    else out.push({ county: r.county, cities: [{ city: r.city, count: r.count }] });
  }
  return out;
}
