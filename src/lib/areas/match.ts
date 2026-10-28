import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { findArea, normalizeAreaName, type Area } from "@/config/areas";
import { listings } from "@/db/schema";
import { inMarketState } from "@/lib/market-state";

/**
 * How listings are assigned to a neighborhood guide. Pure (no database
 * access), so the rules are unit-tested by rendering the SQL.
 *
 * - Every area matches its name and aliases against `listings.neighborhood`
 *   and `listings.water_body` (RESO WaterBodyName). Real feeds put the
 *   subdivision in `neighborhood`, so a lake home often names its lake only
 *   in WaterBodyName.
 * - An area that *is* a town ("Royston", "Toccoa") also matches `listings.city`,
 *   so the many rural and small-town listings with no subdivision name still
 *   count. A lake never falls back to its post-office town — that would report
 *   all of Hartwell's market as Lake Hartwell's.
 * - A guide's `cities` (a neighboring town it covers as a section, e.g.
 *   Hoschton in Braselton) also match `listings.city`, county-scoped the same way.
 * - A listing with a county must be in one of the area's `counties`. Names
 *   repeat across a statewide feed: a subdivision called "Jefferson" in
 *   Chatham County is not Jefferson, Jackson County. Every listing must be
 *   in Georgia (`inMarketState`), with or without a county.
 * - Comparisons ignore case and punctuation on both sides (`normalizeAreaName`
 *   and its SQL twin below), so "Hartwell-Lake" in a feed still matches.
 */
export function areaMatchKeys(area: Pick<Area, "name" | "city" | "aliases" | "cities">): {
  neighborhoods: string[];
  cities: string[];
} {
  const neighborhoods = unique([area.name, ...(area.aliases ?? [])].map(normalizeAreaName));
  const city = normalizeAreaName(area.city);
  return {
    neighborhoods,
    cities: unique([
      ...(normalizeAreaName(area.name) === city ? [city] : []),
      ...(area.cities ?? []).map(normalizeAreaName),
    ]),
  };
}

/**
 * SQL mirror of `normalizeAreaName`: lowercase, runs of non-alphanumerics → one space, trimmed.
 * The listings table has expression indexes on exactly this text for
 * `neighborhood`, `water_body` and `city` (src/db/schema/listings.ts).
 */
export function normalizedSql(value: AnyColumn | SQL): SQL {
  return sql`btrim(regexp_replace(lower(${value}), '[^a-z0-9]+', ' ', 'g'))`;
}

/**
 * Georgia counties whose names aren't plain Title Case, keyed by their county
 * key: a feed in capitals ("DEKALB") is shown with these, and the spellings
 * people and feeds vary ("De Kalb", "Mc'Duffie") key to the same county.
 * All of Georgia's 159 counties were checked; the rest title-case correctly.
 */
export const COUNTY_NAME_EXCEPTIONS: Readonly<Record<string, string>> = {
  dekalb: "DeKalb",
  mcduffie: "McDuffie",
  mcintosh: "McIntosh",
};

/** An exception's key as two words, where its capital splits it: "dekalb" → "de kalb". */
const SPLIT_KEYS = Object.entries(COUNTY_NAME_EXCEPTIONS).map(([key, name]) => ({
  key,
  at: name.search(/(?<=[a-z])[A-Z]/),
}));

/**
 * A normalized county key, or the start of one, with an exception's split
 * spelling joined up: "de kalb" → "dekalb", "mc duf" → "mcduf". Others as given.
 */
export function joinCountyKey(key: string): string {
  if (!key.includes(" ")) return key;
  const joined = key.replace(/ /g, "");
  return SPLIT_KEYS.some((e) => e.key.startsWith(joined)) ? joined : key;
}

/**
 * The normalized spellings a county key (or the start of one) may have in a
 * feed: "dekalb" → ["dekalb", "de kalb"], "deka" → ["deka", "de ka"],
 * "hall" → ["hall"]. For matching `normalizedCountySql` in SQL.
 */
export function countyKeySpellings(key: string): string[] {
  const out = [key];
  for (const e of SPLIT_KEYS) {
    if (e.key.startsWith(key) && key.length > e.at)
      out.push(`${key.slice(0, e.at)} ${key.slice(e.at)}`);
  }
  return unique(out);
}

/**
 * County key: "Hart", "HART COUNTY" and "hart county" all → "hart"; the
 * exceptions' variants ("De Kalb", "Mc'Duffie") → "dekalb", "mcduffie".
 */
export function normalizeCounty(county: string): string {
  return joinCountyKey(normalizeAreaName(county).replace(/ county$/, ""));
}

/**
 * SQL mirror of `normalizeCounty`, apart from joining an exception's split
 * spelling ("de kalb"): match those with `countyKeySpellings`.
 */
export function normalizedCountySql(value: AnyColumn | SQL): SQL {
  return sql`regexp_replace(${normalizedSql(value)}, ' county$', '')`;
}

/**
 * A feed's county as shown: "HALL", "hall county" → "Hall County"; a
 * mixed-case spelling keeps its capitals ("Ben Hill" → "Ben Hill County"),
 * and an exception is always spelled its way ("DEKALB", "De Kalb" → "DeKalb County").
 */
export function countyDisplay(county: string): string {
  const name = county.trim().replace(/\s+county$/i, "");
  const shown =
    COUNTY_NAME_EXCEPTIONS[normalizeCounty(name)] ??
    (name === name.toUpperCase() || name === name.toLowerCase()
      ? name
          .toLowerCase()
          .replace(/(^|[\s\-'.])([a-z])/g, (_, p: string, c: string) => p + c.toUpperCase())
      : name);
  return `${shown} County`;
}

/**
 * `normalizedCountySql` with an exception's split spelling joined ("de kalb"
 * → "dekalb"), so its spellings group as one county.
 */
export function canonicalCountySql(value: AnyColumn | SQL): SQL {
  const key = normalizedCountySql(value);
  return sql`(case when replace(${key}, ' ', '') = any(${textArray(
    Object.keys(COUNTY_NAME_EXCEPTIONS),
  )}) then replace(${key}, ' ', '') else ${key} end)`;
}

/**
 * The listing is in Georgia, and has no county or one of the area's. An
 * out-of-state listing never counts, even without a county: a Gainesville, FL
 * home is not in the Gainesville guide.
 */
export function inAreaCounties(area: Pick<Area, "counties">): SQL {
  return sql`(${inMarketState()} and (${listings.county} is null or ${normalizedCountySql(listings.county)} = any(${textArray(
    area.counties.map(normalizeCounty),
  )})))`;
}

/** A `text[]` literal built from bound parameters. */
export function textArray(values: string[]): SQL {
  if (!values.length) return sql`array[]::text[]`;
  return sql`array[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * Cheap LIKE prefilter for normalized matching. If `normalizedSql(col)` equals
 * a key, the key's tokens are exactly the alphanumeric runs of `lower(col)`,
 * so `lower(col)` must contain the key's first token. Postgres runs the cheap
 * LIKE before the regex, so the regex only sees plausible rows — a large win
 * on a statewide feed where most listings match no guide.
 */
export function prefilterPatterns(keys: string[]): string[] {
  return unique(keys.map((k) => `%${k.split(" ")[0]}%`));
}

/** `col` matches one of the normalized `keys` (prefilter first, then exact normalized equality). */
export function normalizedMatch(col: AnyColumn, keys: string[]): SQL {
  if (!keys.length) return sql`false`;
  return sql`(lower(${col}) like any(${textArray(prefilterPatterns(keys))}) and ${normalizedSql(col)} = any(${textArray(keys)}))`;
}

/** WHERE fragment selecting the listings that belong to `area`. */
export function areaCondition(
  area: Pick<Area, "name" | "city" | "aliases" | "cities" | "counties">,
): SQL {
  const keys = areaMatchKeys(area);
  const parts = [
    normalizedMatch(listings.neighborhood, keys.neighborhoods),
    normalizedMatch(listings.waterBodyName, keys.neighborhoods),
  ];
  if (keys.cities.length) parts.push(normalizedMatch(listings.city, keys.cities));
  return sql`((${sql.join(parts, sql` or `)}) and ${inAreaCounties(area)})`;
}

export type AreaKeyRow = {
  slug: string;
  /** "neighborhood" keys also match `water_body`. */
  kind: "neighborhood" | "city";
  key: string;
  /** The area's counties, normalized (`normalizeCounty`). */
  counties: string[];
};

/**
 * One row per (area, kind, key) for matching many areas at once: the SQL
 * joins listings to these rows on plain equality, which Postgres can hash,
 * instead of an OR across arrays that forces a nested loop.
 */
export function areaKeyRows(
  list: Pick<Area, "slug" | "name" | "city" | "aliases" | "cities" | "counties">[],
): AreaKeyRow[] {
  return list.flatMap((a) => {
    const k = areaMatchKeys(a);
    const counties = a.counties.map(normalizeCounty);
    return [
      ...k.neighborhoods.map((key) => ({
        slug: a.slug,
        kind: "neighborhood" as const,
        key,
        counties,
      })),
      ...k.cities.map((key) => ({ slug: a.slug, kind: "city" as const, key, counties })),
    ];
  });
}

/**
 * Normalized names an agent's `serviceAreas` entry may use for this area: the
 * area's own names, or any of its counties ("Franklin County"), since agents
 * in a rural market often describe their territory by county.
 */
export function serviceAreaKeys(
  area: Pick<Area, "name" | "city" | "aliases" | "cities" | "counties">,
): string[] {
  const keys = areaMatchKeys(area);
  const counties = area.counties.map((c) => normalizeAreaName(`${c} County`));
  return unique([...keys.neighborhoods, ...keys.cities, ...counties]);
}

/**
 * The guide for a listing's location, if we publish one: its neighborhood
 * first ("Lake Hartwell"), then its lake (WaterBodyName), then its city
 * ("Royston"). A city without a guide never matches, and neither does a
 * guide outside the listing's county (when the listing has one).
 */
export function guideForLocation(
  neighborhood: string | null | undefined,
  city: string | null | undefined,
  county?: string | null,
  waterBody?: string | null,
): Area | undefined {
  const inCounty = (a: Area | undefined) =>
    a && (!county || a.counties.some((c) => normalizeCounty(c) === normalizeCounty(county)))
      ? a
      : undefined;
  return (
    inCounty(findArea(neighborhood)) ?? inCounty(findArea(waterBody)) ?? inCounty(findArea(city))
  );
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
