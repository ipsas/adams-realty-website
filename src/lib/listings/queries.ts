import { and, asc, desc, eq, gt, inArray, ne, or, sql } from "drizzle-orm";
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
import { formatStreet } from "@/lib/format";
import { defaultTypesCondition, listedWithin, soldWithin } from "@/lib/search/query";
import { MAX_AREA_SUGGESTIONS, shapeAreaSuggestions, type Suggestion } from "@/lib/search/suggest";
import { cardColumns, officeLookupName, selectCards, withPhotos } from "./card";
import { publicListingColumns } from "./public-fields";
import { canShowDetails, primaryPhotoOnly, publicListing } from "./visibility";

const LIVE_STATUSES = ["active", "coming_soon", "active_under_contract", "pending"] as const;

/**
 * Full property page payload. `cache` dedupes the call between generateMetadata and the page.
 * Null for a feed listing Georgia MLS rules keep off the site (a hidden status,
 * or gone from the feed), and a sold or off-market feed listing carries its
 * primary photo only (src/lib/listings/visibility.ts). No compensation fields
 * (./public-fields.ts).
 */
export const getListingBySlug = cache(async (slug: string) => {
  const [row] = await db
    .select({
      listing: publicListingColumns,
      source: dataSources,
      officeLookupName: officeLookupName(),
    })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .where(eq(listings.slug, slug))
    .limit(1);
  if (!row) return null;
  // For listingOfficeLabel, beside the listing's own columns.
  const listing = { ...row.listing, officeLookupName: row.officeLookupName };
  const { source } = row;
  if (!canShowDetails(listing)) return null;

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
    media: primaryPhotoOnly(listing) ? media.filter((m) => m.kind === "photo").slice(0, 1) : media,
    source: {
      id: source.id,
      slug: source.slug,
      name: source.name,
      kind: source.kind,
      disclaimer: source.disclaimer,
      lastSyncedAt: source.lastSyncedAt,
    },
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
        publicListing(),
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
        publicListing(),
        inArray(listings.status, ["active", "coming_soon"]),
        eq(listings.transactionType, "sale"),
      ),
    )
    .orderBy(sql`${listings.listDate} desc nulls last`)
    .limit(limit);
  return withPhotos(db, rows);
}

/** Same area and type, priced within ±25%, closest in price first. */
export async function getSimilarListings(
  l: Pick<
    typeof listings.$inferSelect,
    "id" | "transactionType" | "listPrice" | "city" | "neighborhood"
  >,
  limit = 4,
) {
  const rows = await selectCards(db)
    .where(
      and(
        publicListing(),
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

/**
 * An agent's public listings, live ones first. `includeClosed: false` leaves out
 * their sales: on the demo site every listing is a sample, so a "Sold" card on a
 * real agent's profile would be an invented sales record.
 */
export async function getAgentListings(
  agentId: string,
  { includeClosed = true, limit = 12 }: { includeClosed?: boolean; limit?: number } = {},
) {
  const live = inArray(listings.status, [...LIVE_STATUSES]);
  const rows = await selectCards(db)
    .where(
      and(
        publicListing(),
        eq(listings.listAgentId, agentId),
        // Sales as the sold search shows them (soldWithin), so these match the page's count.
        includeClosed ? or(live, and(...soldWithin())) : live,
      ),
    )
    .orderBy(
      sql`${listings.status} = 'closed'`,
      sql`${listings.listDate} desc nulls last`,
      listings.id,
    )
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

export type { Suggestion } from "@/lib/search/suggest";

/**
 * Location autocomplete: areas first, then matching addresses. Area names and
 * counts come from the `places` materialized view (rebuilt after each sync,
 * seed and dashboard listing change; see refreshPlaces), so a keystroke reads
 * a few index entries instead of every live listing sharing the prefix. A
 * lake is one "lake area" suggestion, and towns whose homes have all sold are
 * offered too (`shapeAreaSuggestions`).
 */
export async function getLocationSuggestions(term: string): Promise<Suggestion[]> {
  const t = term.trim();
  if (t.length < 2) return [];
  const escaped = t.replace(/[%_\\]/g, "\\$&");
  const live = and(publicListing(), inArray(listings.status, [...LIVE_STATUSES]));

  const [areas, pastOnly, addresses] = await Promise.all([
    db
      .select({ kind: places.kind, label: places.label, sublabel: places.sublabel, n: places.n })
      .from(places)
      .where(sql`lower(${places.label}) like ${`${escaped.toLowerCase()}%`}`)
      .orderBy(desc(places.n), asc(places.label))
      // Room for a lake's rows (one per town) to fold into one suggestion.
      .limit(12),
    // Towns with past sales, in the sold scope's trigram index; the shaping
    // keeps only those with nothing listed now.
    db
      .select({ city: listings.city })
      .from(listings)
      .where(
        and(
          publicListing(),
          eq(listings.transactionType, "sale"),
          eq(listings.status, "closed"),
          sql`${listings.city} ilike ${`${escaped}%`}`,
        ),
      )
      .groupBy(listings.city)
      .orderBy(sql`count(*) desc`, listings.city)
      .limit(MAX_AREA_SUGGESTIONS),
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
    ...shapeAreaSuggestions(
      t,
      areas,
      pastOnly.map((r) => r.city),
    ),
    ...addresses.map((a) => ({
      kind: "address" as const,
      label: formatStreet(a),
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
        publicListing(),
        eq(listings.status, "active"),
        eq(listings.transactionType, "sale"),
        defaultTypesCondition(),
      ),
    )
    .groupBy(listings.city)
    .orderBy(sql`count(*) desc`, listings.city)
    .limit(limit);
}

/**
 * The for-sale set the default /homes search shows (and `listings_buy_*` indexes cover):
 * commercial property left out, as there (`defaultTypesCondition`).
 */
const forSaleNow = () =>
  and(
    publicListing(),
    eq(listings.transactionType, "sale"),
    inArray(listings.status, ["active", "coming_soon"]),
    defaultTypesCondition(),
  );

/**
 * Headline numbers for the homepage. Every count is over public listings only
 * (`publicListing()`), so none counts a home the site won't show. "New this
 * week" counts what its link, `/homes?maxDaysOnMarket=7`, lists (the for-sale
 * set listed in the last 7 days; not pending or sold homes). "Open houses
 * this week" counts the homes its link, `/homes?openHouse=1`, lists (the
 * for-sale set with an open house that hasn't ended) whose next open house
 * starts within 7 days.
 */
export async function getMarketStats() {
  // Uncorrelated (select fields render columns unqualified, so a correlated
  // `listing_id = id` would bind both to open_houses), and Postgres hashes it once.
  const openHouseThisWeek = db
    .select({ id: openHouses.listingId })
    .from(openHouses)
    .where(
      and(
        sql`${openHouses.endsAt} > now()`,
        sql`${openHouses.startsAt} < now() + interval '7 days'`,
      ),
    );
  const [row] = await db
    .select({
      // What /homes lists by default: the for-sale set without commercial property.
      active: sql<number>`count(*) filter (where ${forSaleNow()})::int`,
      // What its link, /homes?maxDaysOnMarket=7, lists: for sale now and listed in the last 7 days.
      newThisWeek: sql<number>`count(*) filter (where ${and(forSaleNow(), listedWithin(7))})::int`,
      medianPrice: sql<number>`(percentile_cont(0.5) within group (order by ${listings.listPrice}) filter (where ${listings.status} = 'active' and ${listings.transactionType} = 'sale' and ${defaultTypesCondition()}))::int`,
      openHouses: sql<number>`count(*) filter (where ${and(forSaleNow(), inArray(listings.id, openHouseThisWeek))})::int`,
    })
    .from(listings)
    .where(publicListing());
  return row;
}

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

/**
 * The listing a problem report is about (/listing-corrections?listing=<slug>):
 * just enough to name it. Null for unknown slugs and for feed listings the
 * rules keep off the site (the report form still works without it).
 */
export async function getListingForReport(slug: string) {
  const [row] = await db
    .select({
      id: listings.id,
      mlsNumber: listings.mlsNumber,
      addressLine1: listings.addressLine1,
      unitNumber: listings.unitNumber,
      city: listings.city,
      state: listings.state,
      postalCode: listings.postalCode,
      hideAddress: listings.hideAddress,
      fromFeed: listings.fromFeed,
      status: listings.status,
      removedAt: listings.removedAt,
    })
    .from(listings)
    .where(eq(listings.slug, slug.slice(0, 200)))
    .limit(1);
  return row && canShowDetails(row) ? row : null;
}
