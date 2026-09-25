import { z } from "zod";

/**
 * The search page is URL-driven: the query string is the single source of
 * truth, so every search is linkable, back-button friendly, crawlable, and
 * can be stored verbatim as a saved search.
 *
 * Parsing is lenient on purpose — an invalid value is dropped rather than
 * failing the page, because these URLs get hand-edited and shared.
 */

export const PROPERTY_TYPES = [
  "single_family",
  "condo",
  "townhouse",
  "multi_family",
  "manufactured",
  "land",
  "farm_ranch",
  "commercial",
  "other",
] as const;
export type PropertyTypeValue = (typeof PROPERTY_TYPES)[number];

export const SEARCH_MODES = ["buy", "rent", "sold"] as const;
export type SearchMode = (typeof SEARCH_MODES)[number];

export const SORTS = [
  "recommended",
  "newest",
  "price_asc",
  "price_desc",
  "sqft_desc",
  "price_per_sqft_asc",
] as const;
export type SortValue = (typeof SORTS)[number];

export const FEATURE_FLAGS = [
  "garage",
  "pool",
  "waterfront",
  "view",
  "basement",
  "newConstruction",
  "singleStory",
  "openHouse",
  "virtualTour",
  "ourListings",
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const PAGE_SIZE = 24;

export type Bounds = { west: number; south: number; east: number; north: number };

export type SearchCriteria = {
  mode: SearchMode;
  q?: string;
  minPrice?: number;
  maxPrice?: number;
  beds?: number;
  baths?: number;
  types?: PropertyTypeValue[];
  minSqft?: number;
  maxSqft?: number;
  minLotSqft?: number;
  minYear?: number;
  maxYear?: number;
  maxHoa?: number;
  maxDaysOnMarket?: number;
  /** Include under-contract and pending listings in "buy" mode. */
  pending?: boolean;
  /** "sold" mode lookback window in days. */
  soldWithinDays?: number;
  bounds?: Bounds;
  sort: SortValue;
  page: number;
} & Partial<Record<FeatureFlag, boolean>>;

export const DEFAULT_CRITERIA: SearchCriteria = { mode: "buy", sort: "recommended", page: 1 };

type RawParams = URLSearchParams | Record<string, string | string[] | undefined>;

function get(raw: RawParams, key: string): string | undefined {
  if (raw instanceof URLSearchParams) return raw.get(key) ?? undefined;
  const v = raw[key];
  return Array.isArray(v) ? v[0] : v;
}

const intish = (min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).optional().catch(undefined);

const numish = (min: number, max: number) =>
  z.coerce.number().min(min).max(max).optional().catch(undefined);

const flag = z
  .enum(["1", "true"])
  .transform(() => true as const)
  .optional()
  .catch(undefined);

function parseList<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
): T[] | undefined {
  if (!value) return undefined;
  const items = value
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is T => (allowed as readonly string[]).includes(s));
  return items.length ? Array.from(new Set(items)) : undefined;
}

export function parseBounds(value: string | undefined): Bounds | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return undefined;
  const [west, south, east, north] = parts;
  if (south < -90 || north > 90 || south >= north) return undefined;
  if (west < -180 || east > 180 || west >= east) return undefined;
  return { west, south, east, north };
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

export function formatBounds(b: Bounds): string {
  return [b.west, b.south, b.east, b.north].map(round).join(",");
}

export function parseSearchParams(raw: RawParams): SearchCriteria {
  const c: SearchCriteria = {
    mode: z
      .enum(SEARCH_MODES)
      .catch("buy")
      .parse(get(raw, "mode") ?? "buy"),
    sort: z
      .enum(SORTS)
      .catch("recommended")
      .parse(get(raw, "sort") ?? "recommended"),
    page: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .catch(1)
      .parse(get(raw, "page") ?? 1),
  };

  const q = get(raw, "q")?.trim().slice(0, 120);
  if (q) c.q = q;

  const assign = <K extends keyof SearchCriteria>(key: K, value: SearchCriteria[K] | undefined) => {
    if (value !== undefined) c[key] = value;
  };

  assign("minPrice", intish(0, 1_000_000_000).parse(get(raw, "minPrice")));
  assign("maxPrice", intish(0, 1_000_000_000).parse(get(raw, "maxPrice")));
  assign("beds", intish(0, 20).parse(get(raw, "beds")));
  assign("baths", numish(0, 20).parse(get(raw, "baths")));
  assign("minSqft", intish(0, 1_000_000).parse(get(raw, "minSqft")));
  assign("maxSqft", intish(0, 1_000_000).parse(get(raw, "maxSqft")));
  assign("minLotSqft", intish(0, 1_000_000_000).parse(get(raw, "minLotSqft")));
  assign("minYear", intish(1700, 2100).parse(get(raw, "minYear")));
  assign("maxYear", intish(1700, 2100).parse(get(raw, "maxYear")));
  assign("maxHoa", intish(0, 100_000).parse(get(raw, "maxHoa")));
  assign("maxDaysOnMarket", intish(1, 3650).parse(get(raw, "maxDaysOnMarket")));
  assign("soldWithinDays", intish(1, 3650).parse(get(raw, "soldWithinDays")));
  assign("pending", flag.parse(get(raw, "pending")));
  assign("types", parseList(get(raw, "types"), PROPERTY_TYPES));
  assign("bounds", parseBounds(get(raw, "bounds")));

  for (const f of FEATURE_FLAGS) assign(f, flag.parse(get(raw, f)));

  // Swap inverted ranges instead of returning nothing.
  if (c.minPrice !== undefined && c.maxPrice !== undefined && c.minPrice > c.maxPrice) {
    [c.minPrice, c.maxPrice] = [c.maxPrice, c.minPrice];
  }
  if (c.minSqft !== undefined && c.maxSqft !== undefined && c.minSqft > c.maxSqft) {
    [c.minSqft, c.maxSqft] = [c.maxSqft, c.minSqft];
  }
  return c;
}

/** Inverse of `parseSearchParams`. Omits defaults so URLs stay short. */
export function serializeCriteria(c: Partial<SearchCriteria>): URLSearchParams {
  const p = new URLSearchParams();
  if (c.q) p.set("q", c.q);
  if (c.mode && c.mode !== "buy") p.set("mode", c.mode);
  const nums = [
    "minPrice",
    "maxPrice",
    "beds",
    "baths",
    "minSqft",
    "maxSqft",
    "minLotSqft",
    "minYear",
    "maxYear",
    "maxHoa",
    "maxDaysOnMarket",
    "soldWithinDays",
  ] as const;
  for (const k of nums) {
    const v = c[k];
    if (v !== undefined && v !== null) p.set(k, String(v));
  }
  if (c.types?.length) p.set("types", c.types.join(","));
  if (c.pending) p.set("pending", "1");
  for (const f of FEATURE_FLAGS) if (c[f]) p.set(f, "1");
  if (c.bounds) p.set("bounds", formatBounds(c.bounds));
  if (c.sort && c.sort !== "recommended") p.set("sort", c.sort);
  if (c.page && c.page > 1) p.set("page", String(c.page));
  return p;
}

export function searchHref(c: Partial<SearchCriteria>): string {
  const qs = serializeCriteria(c).toString();
  return qs ? `/homes?${qs}` : "/homes";
}

/** Count of active filters, for the "Filters (3)" badge. Excludes location, sort, page, bounds. */
export function countActiveFilters(c: SearchCriteria): number {
  let n = 0;
  if (c.minPrice !== undefined || c.maxPrice !== undefined) n++;
  if (c.beds !== undefined) n++;
  if (c.baths !== undefined) n++;
  if (c.types?.length) n++;
  if (c.minSqft !== undefined || c.maxSqft !== undefined) n++;
  if (c.minLotSqft !== undefined) n++;
  if (c.minYear !== undefined || c.maxYear !== undefined) n++;
  if (c.maxHoa !== undefined) n++;
  if (c.maxDaysOnMarket !== undefined) n++;
  if (c.pending) n++;
  for (const f of FEATURE_FLAGS) if (c[f]) n++;
  return n;
}

const TYPE_LABELS: Record<PropertyTypeValue, string> = {
  single_family: "Houses",
  condo: "Condos",
  townhouse: "Townhomes",
  multi_family: "Multi-family",
  manufactured: "Manufactured",
  land: "Land",
  farm_ranch: "Farms & ranches",
  commercial: "Commercial",
  other: "Other",
};

/** Plural nouns for search summaries ("Commercial property in Commerce"). */
const TYPE_NOUNS: Record<PropertyTypeValue, string> = {
  ...TYPE_LABELS,
  multi_family: "Multi-family homes",
  manufactured: "Manufactured homes",
  commercial: "Commercial property",
  other: "Properties",
};

export function propertyTypeLabel(t: PropertyTypeValue): string {
  return TYPE_LABELS[t];
}

function shortMoney(n: number): string {
  if (n >= 1_000_000) return `$${+(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

/** Human summary, used as the default saved-search name and page title. */
export function describeCriteria(c: SearchCriteria): string {
  const parts: string[] = [];
  if (c.beds) parts.push(`${c.beds}+ bd`);
  const noun =
    c.types?.length === 1
      ? TYPE_NOUNS[c.types[0]].toLowerCase()
      : c.mode === "rent"
        ? "rentals"
        : "homes";
  parts.push(c.mode === "sold" ? `sold ${noun}` : noun);
  if (c.q) parts.push(`in ${c.q}`);
  else if (c.bounds) parts.push("in map area");
  if (c.minPrice && c.maxPrice) parts.push(`${shortMoney(c.minPrice)}–${shortMoney(c.maxPrice)}`);
  else if (c.maxPrice) parts.push(`under ${shortMoney(c.maxPrice)}`);
  else if (c.minPrice) parts.push(`over ${shortMoney(c.minPrice)}`);
  const s = parts.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
