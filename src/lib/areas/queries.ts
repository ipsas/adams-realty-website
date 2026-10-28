import { and, asc, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Area } from "@/config/areas";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { selectCards, withPhotos } from "@/lib/listings/card";
import { SQFT_PER_ACRE } from "@/lib/listings/land";
import { publicListing } from "@/lib/listings/visibility";
import { inMarketState } from "@/lib/market-state";
import {
  areaCondition,
  areaKeyRows,
  normalizedCountySql,
  normalizedSql,
  prefilterPatterns,
  serviceAreaKeys,
  textArray,
  type AreaKeyRow,
} from "./match";
import { showcaseListing } from "./showcase";
import {
  addDays,
  emptyStats,
  marketToday,
  NEW_WINDOW_DAYS,
  SOLD_WINDOW_DAYS,
  type AreaStats,
} from "./stats";

type StatsRow = {
  slug: string;
  forSale: number;
  underContract: number;
  rentals: number;
  medianListPrice: number | null;
  minListPrice: number | null;
  maxListPrice: number | null;
  medianPricePerSqft: number | null;
  pricePerSqftSample: number;
  medianPricePerAcre: number | null;
  pricePerAcreSample: number;
  medianDaysOnMarket: number | null;
  daysOnMarketSample: number;
  newListings: number;
  listDateSample: number;
  recentSales: number;
  medianSoldPrice: number | null;
  medianSaleToList: number | null;
  houses: number;
  land: number;
  attached: number;
  other: number;
  photo: string | null;
  lastUpdated: Date | string | null;
};

const LIVE_FOR_SALE = ["active", "coming_soon"] as const;

/**
 * What the guide counts and lists as for sale: live sale listings that may
 * front it (`showcaseListing`). getAreaStats and the grid share it, so the
 * hero, the tiles and the grid agree.
 */
function areaForSale(): SQL {
  return and(
    eq(listings.transactionType, "sale"),
    inArray(listings.status, [...LIVE_FOR_SALE]),
    showcaseListing(),
  )!;
}

/**
 * Live market stats for any number of areas in one query. Each listing's
 * neighborhood, lake (water_body), city and county are normalized once (only
 * for rows that pass the LIKE prefilter), then hash-joined to one row per
 * (area, key), keeping Georgia listings in the area's counties (or with no county);
 * `union` dedupes a listing that matches an area more than one way. A listing counts once per area it
 * belongs to, and medians are true medians. Dates are the market's calendar
 * dates, not the server's. (~0.2s for 50k listings × 20 areas on a laptop;
 * the naive OR-join was ~1.5s.)
 */
export async function getAreaStats(
  list: Area[],
  now: Date = new Date(),
): Promise<Map<string, AreaStats>> {
  const out = new Map(list.map((a) => [a.slug, emptyStats()]));
  if (!list.length) return out;

  const today = marketToday(now);
  const newSince = addDays(today, -NEW_WINDOW_DAYS);
  const soldSince = addDays(today, -SOLD_WINDOW_DAYS);

  const L = listings;
  const sale = sql`${L.transactionType} = 'sale'`;
  const forSale = areaForSale();
  const sold = sql`${sale} and ${L.status} = 'closed' and ${L.closeDate} >= ${soldSince}::date`;
  // $/sqft only means something for homes: a farm's price is mostly land, a
  // storefront's is priced as commercial space.
  const hasSqft = sql`${forSale} and ${L.propertyType} in ('single_family', 'condo', 'townhouse', 'multi_family', 'manufactured') and ${L.livingAreaSqft} > 0`;
  // $/acre is how land is compared (site review #8): bare land and farms with a lot size.
  const hasAcres = sql`${forSale} and ${L.propertyType} in ('land', 'farm_ranch') and coalesce(${L.livingAreaSqft}, 0) = 0 and coalesce(${L.bedrooms}, 0) = 0 and ${L.lotSizeSqft} > 0`;
  // Days on market and new listings are drawn from the same for-sale rows as
  // forSale, so every tile describes the homes it counts.
  const onMarket = sql`${forSale} and ${L.listDate} <= ${today}::date`;
  const hasListDate = sql`${forSale} and ${L.listDate} is not null`;
  const median = (expr: SQL, where: SQL) =>
    sql`percentile_cont(0.5) within group (order by ${expr}) filter (where ${where})`;
  const count = (where: SQL) => sql`count(*) filter (where ${where})::int`;

  const rows = areaKeyRows(list);
  const keys = sql.join(
    rows.map(
      (r) => sql`(${r.slug}::text, ${r.kind}::text, ${r.key}::text, ${textArray(r.counties)})`,
    ),
    sql`, `,
  );
  const keysOf = (kind: AreaKeyRow["kind"]) =>
    rows.filter((r) => r.kind === kind).map((r) => r.key);
  const neighborhoodKeys = keysOf("neighborhood");
  const cityKeys = keysOf("city");

  const result = await db.execute<StatsRow>(sql`
    with area_keys (slug, kind, key, counties) as (values ${keys}),
    normalized as (
      select ${L.id} as id,
        ${normalizedSql(L.neighborhood)} as neighborhood,
        ${normalizedSql(L.waterBodyName)} as water_body,
        ${normalizedSql(L.city)} as city,
        ${normalizedCountySql(L.county)} as county
      from ${L}
      where ${L.removedAt} is null and not ${L.idxHidden} and ${inMarketState()}
        and (lower(${L.neighborhood}) like any(${textArray(prefilterPatterns(neighborhoodKeys))})
          or lower(${L.waterBodyName}) like any(${textArray(prefilterPatterns(neighborhoodKeys))})
          or lower(${L.city}) like any(${textArray(prefilterPatterns(cityKeys))}))
    ),
    matched as (
      select n.id, k.slug from normalized n
        join area_keys k on k.kind = 'neighborhood' and k.key = n.neighborhood
        where n.county is null or n.county = any(k.counties)
      union
      select n.id, k.slug from normalized n
        join area_keys k on k.kind = 'neighborhood' and k.key = n.water_body
        where n.county is null or n.county = any(k.counties)
      union
      select n.id, k.slug from normalized n
        join area_keys k on k.kind = 'city' and k.key = n.city
        where n.county is null or n.county = any(k.counties)
    )
    select
      m.slug,
      ${count(forSale)} as "forSale",
      ${count(sql`${sale} and ${L.status} in ('active_under_contract', 'pending')`)} as "underContract",
      ${count(sql`${L.transactionType} = 'rent' and ${L.status} = 'active'`)} as "rentals",
      ${median(sql`${L.listPrice}`, forSale)}::int as "medianListPrice",
      min(${L.listPrice}) filter (where ${forSale}) as "minListPrice",
      max(${L.listPrice}) filter (where ${forSale}) as "maxListPrice",
      ${median(sql`${L.listPrice}::float8 / ${L.livingAreaSqft}`, hasSqft)}::int as "medianPricePerSqft",
      ${count(hasSqft)} as "pricePerSqftSample",
      ${median(sql`${L.listPrice}::float8 / (${L.lotSizeSqft}::float8 / ${SQFT_PER_ACRE})`, hasAcres)}::int as "medianPricePerAcre",
      ${count(hasAcres)} as "pricePerAcreSample",
      ${median(sql`${today}::date - ${L.listDate}`, onMarket)}::int as "medianDaysOnMarket",
      ${count(onMarket)} as "daysOnMarketSample",
      ${count(sql`${forSale} and ${L.listDate} between ${newSince}::date and ${today}::date`)} as "newListings",
      ${count(hasListDate)} as "listDateSample",
      ${count(sold)} as "recentSales",
      ${median(sql`${L.closePrice}`, sql`${sold} and ${L.closePrice} > 0`)}::int as "medianSoldPrice",
      ${median(
        sql`${L.closePrice}::float8 / ${L.listPrice}`,
        sql`${sold} and ${L.closePrice} > 0 and ${L.listPrice} > 0`,
      )} as "medianSaleToList",
      ${count(sql`${forSale} and ${L.propertyType} in ('single_family', 'manufactured')`)} as "houses",
      ${count(sql`${forSale} and ${L.propertyType} in ('land', 'farm_ranch')`)} as "land",
      ${count(sql`${forSale} and ${L.propertyType} in ('townhouse', 'condo')`)} as "attached",
      ${count(sql`${forSale} and ${L.propertyType} not in ('single_family', 'manufactured', 'land', 'farm_ranch', 'townhouse', 'condo')`)} as "other",
      (array_agg(${L.primaryPhotoUrl} order by ${L.isFeatured} desc, ${L.listPrice} desc)
        filter (where ${forSale} and ${L.primaryPhotoUrl} is not null))[1] as "photo",
      max(${L.updatedAt}) as "lastUpdated"
    from matched m
    join ${L} on ${L.id} = m.id
    group by m.slug
  `);

  for (const r of result.rows) {
    out.set(r.slug, {
      forSale: r.forSale,
      underContract: r.underContract,
      rentals: r.rentals,
      medianListPrice: r.medianListPrice,
      minListPrice: r.minListPrice,
      maxListPrice: r.maxListPrice,
      medianPricePerSqft: r.medianPricePerSqft,
      pricePerSqftSample: r.pricePerSqftSample,
      medianPricePerAcre: r.medianPricePerAcre,
      pricePerAcreSample: r.pricePerAcreSample,
      medianDaysOnMarket: r.medianDaysOnMarket,
      daysOnMarketSample: r.daysOnMarketSample,
      newListings: r.newListings,
      listDateSample: r.listDateSample,
      recentSales: r.recentSales,
      medianSoldPrice: r.medianSoldPrice,
      medianSaleToList: r.medianSaleToList === null ? null : Number(r.medianSaleToList),
      mix: { houses: r.houses, land: r.land, attached: r.attached, other: r.other },
      photo: r.photo,
      lastUpdated: r.lastUpdated ? new Date(r.lastUpdated) : null,
    });
  }
  return out;
}

/** The homes the guide's for-sale grid draws from. */
function areaGridPool(area: Area) {
  return and(publicListing(), areaForSale(), areaCondition(area));
}

/** Newest homes for sale in the area, as listing cards. */
export async function getAreaListings(area: Area, limit = 8) {
  const rows = await selectCards(db)
    .where(areaGridPool(area))
    .orderBy(sql`${listings.listDate} desc nulls last`, desc(listings.listPrice))
    .limit(limit);
  return withPhotos(db, rows);
}

/** How many homes `getAreaListings` draws from. */
export async function getAreaListingCount(area: Area): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(areaGridPool(area));
  return row?.n ?? 0;
}

/**
 * The home that fronts the guide: one with a photo if any has one, featured
 * first, else the priciest. Homes without photos still qualify (the card
 * shows a placeholder), so there's a lead home whenever anything is for sale.
 */
export async function getAreaFeaturedListing(area: Area) {
  const [row] = await selectCards(db)
    .where(areaGridPool(area))
    .orderBy(
      sql`${listings.primaryPhotoUrl} is null`,
      desc(listings.isFeatured),
      desc(listings.listPrice),
    )
    .limit(1);
  return row ?? null;
}

/** Most recent closed sales within the stats window. */
export async function getAreaRecentSales(area: Area, limit = 4, now: Date = new Date()) {
  const since = addDays(marketToday(now), -SOLD_WINDOW_DAYS);
  return selectCards(db)
    .where(
      and(
        publicListing(),
        eq(listings.transactionType, "sale"),
        eq(listings.status, "closed"),
        sql`${listings.closeDate} >= ${since}::date`,
        areaCondition(area),
      ),
    )
    .orderBy(sql`${listings.closeDate} desc nulls last`)
    .limit(limit);
}

/** Active agents who name this area in their service areas, busiest here first. */
export async function getAreaAgents(area: Area) {
  const rows = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      title: agents.title,
      photoUrl: agents.photoUrl,
      phone: agents.phone,
      sortOrder: agents.sortOrder,
      // Column refs render unqualified inside select fields, which is what we
      // want here: they resolve to the inner `listings`, and "agents"."id" to the outer row.
      listingsHere: sql<number>`(
        select count(*)::int from ${listings}
        where ${listings.listAgentId} = "agents"."id" and ${listings.removedAt} is null and not ${listings.idxHidden}
          and ${listings.status} in ('active', 'coming_soon') and ${areaCondition(area)}
      )`,
    })
    .from(agents)
    .where(
      and(
        eq(agents.isActive, true),
        sql`exists (
          select 1 from unnest(${agents.serviceAreas}) as sa(name)
          where ${normalizedSql(sql`sa.name`)} = any(${textArray(serviceAreaKeys(area))})
        )`,
      ),
    )
    .orderBy(asc(agents.sortOrder), asc(agents.name));
  return rows.sort((a, b) => b.listingsHere - a.listingsHere);
}

export type AreaAgent = Awaited<ReturnType<typeof getAreaAgents>>[number];
