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
  "lot_desc",
  "price_per_acre_asc",
] as const;
export type SortValue = (typeof SORTS)[number];

export const SORT_LABELS: Record<SortValue, string> = {
  recommended: "Recommended",
  newest: "Newest",
  price_asc: "Price (low to high)",
  price_desc: "Price (high to low)",
  sqft_desc: "Square feet",
  price_per_sqft_asc: "Price per sqft",
  // Land buyers compare tracts by size and price per acre (site review #8).
  lot_desc: "Acreage (most first)",
  price_per_acre_asc: "Price per acre",
};

/** Sort label for the current mode: "newest" reads "Recently sold" in sold mode. */
export function sortLabel(sort: SortValue, mode: SearchMode): string {
  return sort === "newest" && mode === "sold" ? "Recently sold" : SORT_LABELS[sort];
}

/** Shown next to the sort control: how "Recommended" is ordered. */
export const SORT_HELP =
  "No paid placement. Recommended shows Adams-featured homes first, then newest.";

/**
 * The phone results sheet's position, kept in the URL as `view` so Back and
 * relaunch restore it: "map" (sheet at peek) or "list" (sheet full); absent
 * means half. UI state only: not part of SearchCriteria or saved searches.
 *
 * The `view` key is shared with the "View" amenity filter (FEATURE_FLAGS),
 * which serializes as `view=1`. The two are told apart by value and can both
 * be present (`view=1&view=list`), so sheet code must only ever read, add or
 * remove the "map"/"list" values (parseViewParam over getAll("view"),
 * setViewParam) and never set() or delete() the key as a whole.
 */
export const VIEW_PARAMS = ["map", "list"] as const;
export type ViewParam = (typeof VIEW_PARAMS)[number];

const isViewParam = (v: unknown): v is ViewParam => (VIEW_PARAMS as readonly unknown[]).includes(v);

/** The sheet position among `view` value(s); the amenity filter's "1" is ignored. */
export function parseViewParam(
  value: string | readonly string[] | null | undefined,
): ViewParam | undefined {
  const values = typeof value === "string" ? [value] : (value ?? []);
  return values.find(isViewParam);
}

/**
 * Sets the sheet position on `params` in place (null/undefined removes it),
 * leaving the amenity filter's `view=1` untouched.
 */
export function setViewParam(params: URLSearchParams, view: ViewParam | null | undefined): void {
  const kept = params.getAll("view").filter((v) => !isViewParam(v));
  params.delete("view");
  for (const v of kept) params.append("view", v);
  if (view) params.append("view", view);
}

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
  "fireplace",
] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

export const HOA_FILTERS = ["yes", "no"] as const;
export type HoaFilter = (typeof HOA_FILTERS)[number];

export const AGE55_FILTERS = ["only", "exclude"] as const;
export type Age55Filter = (typeof AGE55_FILTERS)[number];

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
  /** Legacy (old saved searches and URLs): the filters dialog writes minAcres instead. */
  minLotSqft?: number;
  minAcres?: number;
  maxAcres?: number;
  minYear?: number;
  maxYear?: number;
  maxHoa?: number;
  /** Has an HOA ("yes") or not ("no"); absent is any, unknowns included. */
  hoa?: HoaFilter;
  /** Words in the listing text (search_vector), separate from the location box `q`. */
  kw?: string;
  /** Priced below the original list price. Not parsed, applied, counted or serialized in "sold" mode. */
  priceReduced?: boolean;
  /** 55+ communities: absent includes them. */
  age55?: Age55Filter;
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

function getAll(raw: RawParams, key: string): string[] {
  if (raw instanceof URLSearchParams) return raw.getAll(key);
  const v = raw[key];
  return Array.isArray(v) ? v : v === undefined ? [] : [v];
}

/**
 * Plain decimal digits only: no sign, hex (0x10), exponent (1e3), Infinity or
 * blank (which `Number` would read as 0). `numish` also takes one decimal point.
 */
const INT_TEXT = /^\d+$/;
const DECIMAL_TEXT = /^\d+(?:\.\d+)?$/;

const intish = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(INT_TEXT)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .optional()
    .catch(undefined);

const numish = (min: number, max: number) =>
  z
    .string()
    .trim()
    .regex(DECIMAL_TEXT)
    .transform(Number)
    .pipe(z.number().min(min).max(max))
    .optional()
    .catch(undefined);

/** A bounds coordinate: like DECIMAL_TEXT, with an optional minus sign. */
const COORDINATE_TEXT = /^-?\d+(?:\.\d+)?$/;

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
  const text = value.split(",").map((s) => s.trim());
  if (text.length !== 4 || text.some((s) => !COORDINATE_TEXT.test(s))) return undefined;
  const parts = text.map(Number);
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
    page: intish(1, 500).parse(get(raw, "page")) ?? 1,
  };

  const q = get(raw, "q")?.trim().slice(0, 120);
  if (q) c.q = q;
  const kw = get(raw, "kw")?.trim().slice(0, 80).trim();
  if (kw) c.kw = kw;

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
  assign("minAcres", numish(0, 100_000).parse(get(raw, "minAcres")));
  assign("maxAcres", numish(0, 100_000).parse(get(raw, "maxAcres")));
  assign("minYear", intish(1700, 2100).parse(get(raw, "minYear")));
  assign("maxYear", intish(1700, 2100).parse(get(raw, "maxYear")));
  assign("maxHoa", intish(0, 100_000).parse(get(raw, "maxHoa")));
  assign("hoa", z.enum(HOA_FILTERS).optional().catch(undefined).parse(get(raw, "hoa")));
  assign("age55", z.enum(AGE55_FILTERS).optional().catch(undefined).parse(get(raw, "age55")));
  // A sold listing is not "reduced": the filter is dropped in sold mode, not just unapplied.
  if (c.mode !== "sold") assign("priceReduced", flag.parse(get(raw, "priceReduced")));
  assign("maxDaysOnMarket", intish(1, 3650).parse(get(raw, "maxDaysOnMarket")));
  assign("soldWithinDays", intish(1, 3650).parse(get(raw, "soldWithinDays")));
  assign("pending", flag.parse(get(raw, "pending")));
  assign("types", parseList(get(raw, "types"), PROPERTY_TYPES));
  assign("bounds", parseBounds(get(raw, "bounds")));

  // Any value counts: `view` also carries the sheet position (`view=list&view=1`).
  for (const f of FEATURE_FLAGS) {
    assign(f, getAll(raw, f).some((v) => flag.parse(v)) || undefined);
  }

  // Swap inverted ranges instead of returning nothing.
  if (c.minPrice !== undefined && c.maxPrice !== undefined && c.minPrice > c.maxPrice) {
    [c.minPrice, c.maxPrice] = [c.maxPrice, c.minPrice];
  }
  if (c.minSqft !== undefined && c.maxSqft !== undefined && c.minSqft > c.maxSqft) {
    [c.minSqft, c.maxSqft] = [c.maxSqft, c.minSqft];
  }
  if (c.minAcres !== undefined && c.maxAcres !== undefined && c.minAcres > c.maxAcres) {
    [c.minAcres, c.maxAcres] = [c.maxAcres, c.minAcres];
  }
  return c;
}

/** Inverse of `parseSearchParams`. Omits defaults so URLs stay short. */
export function serializeCriteria(c: Partial<SearchCriteria>): URLSearchParams {
  const p = new URLSearchParams();
  if (c.q) p.set("q", c.q);
  if (c.kw) p.set("kw", c.kw);
  if (c.mode && c.mode !== "buy") p.set("mode", c.mode);
  const nums = [
    "minPrice",
    "maxPrice",
    "beds",
    "baths",
    "minSqft",
    "maxSqft",
    "minLotSqft",
    "minAcres",
    "maxAcres",
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
  if (c.hoa) p.set("hoa", c.hoa);
  if (c.age55) p.set("age55", c.age55);
  if (c.priceReduced && c.mode !== "sold") p.set("priceReduced", "1");
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

/**
 * The same /homes URL on another page, every other parameter kept as it was (`view`,
 * `from`, …); page 1 drops the parameter. For a page past the last one.
 */
export function withPageHref(raw: RawParams, page: number): string {
  const p = new URLSearchParams();
  const entries =
    raw instanceof URLSearchParams
      ? [...raw]
      : Object.entries(raw).flatMap(([k, v]) =>
          (Array.isArray(v) ? v : v === undefined ? [] : [v]).map((x) => [k, x] as const),
        );
  for (const [k, v] of entries) if (k !== "page") p.append(k, v);
  if (page > 1) p.set("page", String(page));
  const qs = p.toString();
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
  if (c.minAcres !== undefined || c.maxAcres !== undefined) n++;
  if (c.minYear !== undefined || c.maxYear !== undefined) n++;
  if (c.maxHoa !== undefined) n++;
  if (c.hoa) n++;
  if (c.kw) n++;
  if (c.priceReduced && c.mode !== "sold") n++;
  if (c.age55) n++;
  if (c.maxDaysOnMarket !== undefined) n++;
  if (c.pending) n++;
  for (const f of FEATURE_FLAGS) if (c[f]) n++;
  return n;
}

/** A patch that turns off every filter `countActiveFilters` counts (place, mode and sort stay). */
export function clearedFilters(): Partial<SearchCriteria> {
  const patch: Partial<SearchCriteria> = {
    minPrice: undefined,
    maxPrice: undefined,
    beds: undefined,
    baths: undefined,
    types: undefined,
    minSqft: undefined,
    maxSqft: undefined,
    minLotSqft: undefined,
    minAcres: undefined,
    maxAcres: undefined,
    minYear: undefined,
    maxYear: undefined,
    maxHoa: undefined,
    hoa: undefined,
    kw: undefined,
    priceReduced: undefined,
    age55: undefined,
    maxDaysOnMarket: undefined,
    pending: undefined,
  };
  for (const f of FEATURE_FLAGS) patch[f] = undefined;
  return patch;
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

/**
 * What a search lists, by its property types: "Land" for land alone, "Land & farms" for
 * the two together, "Houses", "Condos"…; null for the default mix (or any other mix),
 * which reads as homes.
 */
export function typesNoun(types: readonly PropertyTypeValue[] | undefined): string | null {
  if (!types?.length) return null;
  if (types.length === 1) return TYPE_NOUNS[types[0]];
  if (types.length === 2 && types.includes("land") && types.includes("farm_ranch"))
    return "Land & farms";
  return null;
}

/**
 * The noun phrase a results heading starts with: "Homes for sale", "Rentals", "Sold
 * homes", or by property type "Land for sale", "Land for rent", "Sold land".
 * `bare` drops "for sale" (for "Homes near Lake Hartwell", "Homes in this map area").
 */
export function listingNoun(
  c: Pick<SearchCriteria, "mode" | "types">,
  { bare = false }: { bare?: boolean } = {},
): string {
  const typed = typesNoun(c.types);
  if (c.mode === "sold") return typed ? `Sold ${typed.toLowerCase()}` : "Sold homes";
  if (c.mode === "rent") return typed ? `${typed} for rent` : "Rentals";
  const noun = typed ?? "Homes";
  return bare ? noun : `${noun} for sale`;
}

/**
 * The no-results panel's words (site review #5), in the search's own terms: a rentals
 * search says rentals, never "homes", and the panel only states what the search checked
 * (nothing of this kind in this place), never that nothing at all is listed there.
 * `where` is "in Carnesville", "in this map area" or "in Georgia".
 */
export function noResultsCopy(
  c: Pick<SearchCriteria, "mode" | "types">,
  where: string,
): { heading: string; alert: string; none: string } {
  if (c.types?.length) {
    return {
      heading: "No listings match — yet",
      alert: "Email me about new listings here",
      none: `No ${listingNoun(c).toLowerCase()} ${where} right now.`,
    };
  }
  if (c.mode === "rent") {
    return {
      heading: "No rentals match — yet",
      alert: "Email me when rentals list here",
      none: `No rentals ${where} right now.`,
    };
  }
  if (c.mode === "sold") {
    return {
      heading: "No sales match — yet",
      alert: "Email me about sales here",
      none: `No recent sales ${where}.`,
    };
  }
  return {
    heading: "No homes match — yet",
    alert: "Email me when homes list here",
    none: `No homes for sale ${where} right now.`,
  };
}

/**
 * The town a map-area search came from (site review #5). Moving the map drops
 * the town (`q`) and searches every home in view; `from` keeps the town's name
 * in the URL so the page can offer "Back to Royston" after a reload too. UI
 * state like the `view` sheet position: not part of SearchCriteria, saved
 * searches or alerts, and only meaningful with `bounds` and no `q`.
 */
export const FROM_PARAM = "from";

export function parseFromParam(raw: RawParams): string | undefined {
  const v = get(raw, FROM_PARAM)?.trim().slice(0, 120);
  return v || undefined;
}

/** Human summary, used as the default saved-search name and page title. */
export function describeCriteria(c: SearchCriteria): string {
  const parts: string[] = [];
  if (c.beds) parts.push(`${c.beds}+ bd`);
  const typed = typesNoun(c.types);
  const noun = typed ? typed.toLowerCase() : c.mode === "rent" ? "rentals" : "homes";
  parts.push(c.mode === "sold" ? `sold ${noun}` : noun);
  if (c.q) parts.push(`in ${c.q}`);
  else if (c.bounds) parts.push("in map area");
  if (c.minPrice && c.maxPrice) parts.push(`${shortMoney(c.minPrice)}–${shortMoney(c.maxPrice)}`);
  else if (c.maxPrice) parts.push(`under ${shortMoney(c.maxPrice)}`);
  else if (c.minPrice) parts.push(`over ${shortMoney(c.minPrice)}`);
  const s = parts.join(" ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
