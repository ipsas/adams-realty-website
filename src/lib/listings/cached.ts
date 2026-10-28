import { unstable_cache } from "next/cache";
import { cache } from "react";
import { areas as allAreas, townGuide } from "@/config/areas";
import { getAreaStats } from "@/lib/areas/queries";
import { emptyStats, marketToday, type AreaStats, type AreaSummary } from "@/lib/areas/stats";
import { RESO_MAPPER_VERSION } from "@/lib/mls/reso/mapper";
import { LISTINGS_CACHE_SECONDS, LISTINGS_TAG } from "./cache-tags";
import { CARD_SHAPE_VERSION, type ListingCardData } from "./card";
import {
  getFeaturedListings,
  getMarketStats,
  getPlacesIndex,
  getPopularAreas,
  getTopCities,
} from "./queries";

/**
 * Listing-derived data that changes only when listings do (a sync or a
 * dashboard edit), cached across requests in Next's data cache. This project
 * doesn't enable Cache Components, so it's `unstable_cache` with a tag (see
 * node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md):
 *
 * - the cron sync calls `revalidateTag(LISTINGS_TAG, "max")` after changes,
 * - dashboard listing and open-house actions call `updateTag(LISTINGS_TAG)`,
 * - everything also expires after LISTINGS_CACHE_SECONDS, because a CLI sync
 *   (the first statewide load) can't reach the running app's cache.
 *
 * The data cache stores JSON, so each entry is round-tripped through JSON on
 * every path and its Date fields revived. Outside production the cache is
 * skipped (still with the JSON round trip): `npm run db:reset` under a running
 * dev server would otherwise serve the old database's rows for 15 minutes.
 *
 * Every key names the code that wrote the entry (CACHE_VERSION), so a
 * deployment or rollback never reads entries of another shape, and every call
 * passes the market's date, so an entry written before midnight in the
 * market's time zone (the "New" badge, this week's counts) is never served
 * after it, even stale-while-revalidate after a quiet night.
 */

const CACHE_ENABLED = process.env.NODE_ENV === "production";

export const CACHE_VERSION = [
  `card-v${CARD_SHAPE_VERSION}`,
  `mapper-v${RESO_MAPPER_VERSION}`,
  process.env.VERCEL_GIT_COMMIT_SHA || "local",
];

function listingsCache<A extends Array<string | number>, R>(
  key: string,
  query: (...args: A) => Promise<R>,
  revive: (json: R) => R = (json) => json,
): (...args: A) => Promise<R> {
  const load = async (...args: A): Promise<R> => JSON.parse(JSON.stringify(await query(...args)));
  // The market date is only part of the entry's key; the query reads its own clock.
  const cached = unstable_cache(
    (_marketDate: string, ...args: A) => load(...args),
    [key, ...CACHE_VERSION],
    { tags: [LISTINGS_TAG], revalidate: LISTINGS_CACHE_SECONDS },
  );
  return async (...args: A) =>
    revive(await (CACHE_ENABLED ? cached(marketToday(), ...args) : load(...args)));
}

// Every Date-typed field, so JSON's strings become Dates again. The Record
// types fail to compile if a Date field is added without being listed here.
type DateKeys<T> = {
  [K in keyof T]-?: Extract<T[K], Date> extends never ? never : K;
}[keyof T];
const CARD_DATES: Record<DateKeys<ListingCardData>, true> = {
  nextOpenHouse: true,
  removedAt: true,
};
const STATS_DATES: Record<DateKeys<AreaStats>, true> = { lastUpdated: true };

function reviveDates<T extends object>(row: T, fields: object): T {
  const out = { ...row } as Record<string, unknown>;
  for (const f of Object.keys(fields)) {
    const v = out[f];
    if (typeof v === "string") out[f] = new Date(v);
  }
  return out as T;
}

const reviveCards = (rows: ListingCardData[]) => rows.map((r) => reviveDates(r, CARD_DATES));
const reviveStats = (stats: AreaStats) => reviveDates(stats, STATS_DATES);

/** Home page headline numbers. */
export const getCachedMarketStats = listingsCache("market-stats", () => getMarketStats());

const areaStatsBySlug = listingsCache(
  "area-summaries",
  async () => [...(await getAreaStats(allAreas))],
  (entries) => entries.map(([slug, stats]) => [slug, reviveStats(stats)] as [string, AreaStats]),
);

const popularAreas = listingsCache("popular-areas", (limit: number) => getPopularAreas(limit));

/**
 * Home page "Towns across…" grid. A town with a guide (its tile links there)
 * shows the guide's own count and median, from the cached guide stats; one
 * the guide counts nothing for sale is left out, as there's no "0 homes" tile.
 */
export async function getCachedPopularAreas(limit: number) {
  const [rows, stats] = await Promise.all([popularAreas(limit), areaStatsBySlug()]);
  const bySlug = new Map(stats);
  return rows
    .flatMap((row) => {
      const guide = townGuide(row.city);
      const s = guide && bySlug.get(guide.slug);
      if (!s) return [row];
      if (!s.forSale) return [];
      return [{ ...row, count: s.forSale, medianPrice: s.medianListPrice ?? row.medianPrice }];
    })
    .sort((a, b) => b.count - a.count);
}

/** Home page featured homes. */
export const getCachedFeaturedListings = listingsCache(
  "featured-listings",
  (limit: number) => getFeaturedListings(limit),
  reviveCards,
);

/** Cities with the most homes for sale (GA-A's home page town chips). */
export const getCachedTopCities = listingsCache("top-cities", (limit: number) =>
  getTopCities(limit),
);

/** Every city with homes for sale, by county (GA-A's "See all towns" index). */
export const getCachedPlacesIndex = listingsCache("places-index", () => getPlacesIndex());

/** Every area guide with its live stats, in config order (/areas and its sitemap). */
export async function getCachedAreaSummaries(): Promise<AreaSummary[]> {
  const stats = new Map(await areaStatsBySlug());
  return allAreas.map((area) => ({ area, stats: stats.get(area.slug) ?? emptyStats() }));
}

const areaGuideStats = listingsCache(
  "area-guide-stats",
  async (slug: string) => {
    const area = allAreas.find((a) => a.slug === slug);
    return area ? ((await getAreaStats([area])).get(slug) ?? emptyStats()) : emptyStats();
  },
  reviveStats,
);

/**
 * One guide's header data; null for unknown slugs (the page 404s). React
 * `cache` also dedupes the call between generateMetadata and the page.
 */
export const getCachedAreaGuide = cache(async (slug: string) => {
  const area = allAreas.find((a) => a.slug === slug) ?? null;
  if (!area) return null;
  return { area, stats: await areaGuideStats(slug) };
});
