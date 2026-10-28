import { areaRegions, type Area, type AreaRegion } from "@/config/areas";
import { site } from "@/config/site";
import { cutAtWord, formatPriceShort } from "@/lib/format";

/**
 * Shapes and pure helpers for neighborhood-guide market stats. The SQL lives
 * in `queries.ts`; everything here is unit-tested.
 */

/** "New listings" window. */
export const NEW_WINDOW_DAYS = 30;
/** "Recent sales" window. */
export const SOLD_WINDOW_DAYS = 180;
/** Below this many data points a median is shown with a small-sample note. */
export const MIN_SAMPLE = 3;

/**
 * Property-type buckets for the "what's for sale" bar, sized for a market
 * that's mostly houses and land. The order and colors are fixed per bucket
 * (never by rank) so a color means the same thing on every guide. Colors were
 * checked, in this order, with the dataviz palette validator on white:
 * lightness band, chroma, CVD and normal-vision separation all pass; the amber
 * sits under 3:1 contrast, so the legend always prints labels and values.
 *
 * houses = single-family + manufactured, land = land + farms,
 * attached = townhomes + condos, other = commercial, multi-family and the rest.
 */
export const MIX_BUCKETS = [
  { key: "houses", label: "Houses", color: "#1f7a55" },
  { key: "land", label: "Land & farms", color: "#e0a126" },
  { key: "attached", label: "Townhomes & condos", color: "#c2562a" },
  { key: "other", label: "Commercial & other", color: "#5a69c4" },
] as const;

export type MixKey = (typeof MIX_BUCKETS)[number]["key"];

export type AreaStats = {
  /** Active + coming soon, for sale. */
  forSale: number;
  /** Under contract or pending, for sale. */
  underContract: number;
  /** Active rentals. */
  rentals: number;
  medianListPrice: number | null;
  minListPrice: number | null;
  maxListPrice: number | null;
  medianPricePerSqft: number | null;
  /** Homes behind the $/sqft median: residential types with a living area (no land, farms or commercial). */
  pricePerSqftSample: number;
  /** Median asking price per acre of bare land and farms for sale (site review #8). */
  medianPricePerAcre: number | null;
  /** Tracts behind the $/acre median: land and farms with no house and a lot size. */
  pricePerAcreSample: number;
  /** Over the for-sale homes (as `forSale`) with a list date on or before today. */
  medianDaysOnMarket: number | null;
  daysOnMarketSample: number;
  /** For-sale homes (as `forSale`) with a list date in the last NEW_WINDOW_DAYS. */
  newListings: number;
  /** For-sale homes (as `forSale`) with any list date: 0 means `newListings` can't be told. */
  listDateSample: number;
  /** Closed sales in the last SOLD_WINDOW_DAYS. */
  recentSales: number;
  medianSoldPrice: number | null;
  /** Median close price ÷ final list price, e.g. 0.983. */
  medianSaleToList: number | null;
  mix: Record<MixKey, number>;
  /** Photo of the area's featured (else most expensive) home for sale. */
  photo: string | null;
  /** Most recent change to any listing in the area. */
  lastUpdated: Date | null;
};

export function emptyStats(): AreaStats {
  return {
    forSale: 0,
    underContract: 0,
    rentals: 0,
    medianListPrice: null,
    minListPrice: null,
    maxListPrice: null,
    medianPricePerSqft: null,
    pricePerSqftSample: 0,
    medianPricePerAcre: null,
    pricePerAcreSample: 0,
    medianDaysOnMarket: null,
    daysOnMarketSample: 0,
    newListings: 0,
    listDateSample: 0,
    recentSales: 0,
    medianSoldPrice: null,
    medianSaleToList: null,
    mix: { houses: 0, land: 0, attached: 0, other: 0 },
    photo: null,
    lastUpdated: null,
  };
}

/** Today's calendar date (YYYY-MM-DD) in the market's time zone. */
export function marketToday(now: Date = new Date(), timeZone: string = site.market.timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Shifts a YYYY-MM-DD date by whole days (calendar math, no time-zone drift). */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type SnapshotTile =
  | "forSale"
  | "listPrice"
  | "pricePerSqft"
  | "pricePerAcre"
  | "daysOnMarket"
  | "newListings"
  | "sales";

/**
 * The market-snapshot tiles that can be calculated, in display order. The
 * homes-for-sale count always shows; any other figure whose inputs are missing
 * (no list dates, no closed sales…) is left out rather than shown as 0 or "—".
 */
export function snapshotTiles(s: AreaStats): SnapshotTile[] {
  const shown: Record<SnapshotTile, boolean> = {
    forSale: true,
    listPrice: s.forSale > 0 && !!s.medianListPrice,
    pricePerSqft: s.pricePerSqftSample > 0 && !!s.medianPricePerSqft,
    pricePerAcre: s.pricePerAcreSample > 0 && !!s.medianPricePerAcre,
    daysOnMarket: s.daysOnMarketSample > 0 && s.medianDaysOnMarket !== null,
    newListings: s.listDateSample > 0,
    sales: s.recentSales > 0,
  };
  return (Object.keys(shown) as SnapshotTile[]).filter((k) => shown[k]);
}

export type MixSegment = {
  key: MixKey;
  label: string;
  color: string;
  count: number;
  /** Whole-number share; segments always sum to exactly 100. */
  pct: number;
};

/**
 * Non-empty property-type segments in fixed bucket order, with shares rounded
 * by largest remainder so the legend never adds up to 99% or 101%.
 */
export function mixSegments(mix: Record<MixKey, number>): MixSegment[] {
  const total = MIX_BUCKETS.reduce((sum, b) => sum + (mix[b.key] || 0), 0);
  if (!total) return [];
  const raw = MIX_BUCKETS.map((b) => {
    const count = mix[b.key] || 0;
    const exact = (count / total) * 100;
    return { ...b, count, pct: Math.floor(exact), remainder: exact - Math.floor(exact) };
  });
  let leftover = 100 - raw.reduce((sum, s) => sum + s.pct, 0);
  for (const s of [...raw].sort((a, b) => b.remainder - a.remainder)) {
    if (leftover <= 0) break;
    s.pct += 1;
    leftover -= 1;
  }
  return raw
    .filter((s) => s.count > 0)
    .map(({ key, label, color, count, pct }) => ({ key, label, color, count, pct }));
}

/**
 * Sale-to-list ratio as a percentage: 0.983 → "98%". Near 100% it keeps one
 * decimal so a median just under (or over) list never reads as exactly "100%".
 */
export function formatRatio(ratio: number): string {
  const pct = ratio * 100;
  const rounded = Math.round(pct);
  if (rounded === 100 && Math.abs(pct - 100) >= 0.05) return `${pct.toFixed(1)}%`;
  return `${rounded}%`;
}

/** "Sep 25, 3:42 PM EDT" in the market's time zone — when live figures were computed. */
export function formatAsOf(d: Date, timeZone: string = site.market.timeZone): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
    timeZoneName: "short",
  }).format(d);
}

/** Wording for how many data points sit behind a figure. */
export function sampleLabel(n: number, noun: [singular: string, plural: string]): string {
  return `${n} ${n === 1 ? noun[0] : noun[1]}`;
}

/**
 * Copy for the guide's lead-photo card when there's no home to put in it,
 * matched to what the rest of the page shows so the two never disagree.
 * `target` is where the card links: the map, or the sales list below.
 */
export function leadPhotoFallback(
  forSale: number,
  recentSales: number,
): { text: string; target: "map" | "sales" } {
  if (forSale > 0) {
    return {
      text: `${sampleLabel(forSale, ["home", "homes"])} for sale, photos coming soon.`,
      target: "map",
    };
  }
  if (recentSales > 0) {
    return { text: "Nothing for sale right now. Recent sales are below.", target: "sales" };
  }
  return { text: "Nothing for sale right now. Save a search to hear first.", target: "map" };
}

/**
 * The guide's for-sale grid without the home already up top as its lead photo,
 * unless it's the only one (the grid is never emptied by it). `homes` is fetched
 * one past `limit` so the grid stays full; `total` is the pool (`poolTotal`,
 * which includes the lead) less the lead when it's left out.
 */
export function areaGrid<T extends { id: string }>(
  homes: T[],
  lead: { id: string } | null,
  limit: number,
  poolTotal: number,
): { homes: T[]; total: number } {
  const others = homes.filter((h) => h.id !== lead?.id);
  const dropLead = !!lead && others.length > 0;
  return {
    homes: (dropLead ? others : homes).slice(0, limit),
    total: poolTotal - (dropLead ? 1 : 0),
  };
}

export type AreaSummary = { area: Area; stats: AreaStats };

export const AREA_SORTS = ["region", "homes", "price-high", "price-low", "name"] as const;
export type AreaSort = (typeof AREA_SORTS)[number];

export function parseAreaSort(value: string | string[] | undefined): AreaSort {
  const v = Array.isArray(value) ? value[0] : value;
  return (AREA_SORTS as readonly string[]).includes(v ?? "") ? (v as AreaSort) : "region";
}

/**
 * Orders area summaries for the index. Areas with nothing for sale sink to
 * the end of price sorts (a missing median isn't "cheapest"). "region" keeps
 * config order, which the page groups by region.
 */
export function sortAreas(list: AreaSummary[], sort: AreaSort): AreaSummary[] {
  const byName = (a: AreaSummary, b: AreaSummary) => a.area.name.localeCompare(b.area.name);
  const price = (s: AreaSummary) => s.stats.medianListPrice;
  const out = [...list];
  switch (sort) {
    case "name":
      return out.sort(byName);
    case "homes":
      return out.sort((a, b) => b.stats.forSale - a.stats.forSale || byName(a, b));
    case "price-high":
    case "price-low": {
      const dir = sort === "price-high" ? -1 : 1;
      return out.sort((a, b) => {
        const pa = price(a);
        const pb = price(b);
        if (pa === null || pb === null) return pa === pb ? byName(a, b) : pa === null ? 1 : -1;
        return (pa - pb) * dir || byName(a, b);
      });
    }
    default:
      return out;
  }
}

/** Groups summaries by region, in `areaRegions` order, skipping empty regions. */
export function groupByRegion(list: AreaSummary[]) {
  return areaRegions
    .map((region) => ({ region, items: list.filter((s) => s.area.region === region.id) }))
    .filter((g) => g.items.length > 0);
}

export function regionLabel(id: AreaRegion): string {
  return areaRegions.find((r) => r.id === id)?.label ?? id;
}

/** "Lake Hartwell, Hartwell" / "Royston, GA": the place name used in titles. */
export function placeName(area: Pick<Area, "name" | "city">): string {
  return area.city === area.name
    ? `${area.name}, ${site.market.state}`
    : `${area.name}, ${area.city}`;
}

/**
 * Meta description that leads with live numbers (fresh, specific snippets
 * outrank boilerplate), then the area description, cut at a word boundary.
 */
export function metaDescription(
  area: Pick<Area, "name" | "city" | "description">,
  stats: Pick<AreaStats, "forSale" | "medianListPrice">,
  max = 160,
): string {
  const market = stats.forSale
    ? `${sampleLabel(stats.forSale, ["home", "homes"])} for sale${
        stats.medianListPrice
          ? `, median list price ${formatPriceShort(stats.medianListPrice)}`
          : ""
      }. `
    : "";
  const text = `${placeName(area)}: ${market}${area.description}`;
  return cutAtWord(text, max);
}
