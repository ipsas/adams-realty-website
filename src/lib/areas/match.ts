import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import { findArea, normalizeAreaName, type Area } from "@/config/areas";
import { listings } from "@/db/schema";

/**
 * How listings are assigned to a neighborhood guide. Pure (no database
 * access), so the rules are unit-tested by rendering the SQL.
 *
 * - Every area matches its name and aliases against `listings.neighborhood`.
 * - An area that *is* a town ("Royston", "Toccoa") also matches `listings.city`,
 *   so the many rural and small-town listings with no subdivision name still
 *   count. A lake never falls back to its post-office town — that would report
 *   all of Hartwell's market as Lake Hartwell's.
 * - Comparisons ignore case and punctuation on both sides (`normalizeAreaName`
 *   and its SQL twin below), so "Hartwell-Lake" in a feed still matches.
 */
export function areaMatchKeys(area: Pick<Area, "name" | "city" | "aliases">): {
  neighborhoods: string[];
  cities: string[];
} {
  const neighborhoods = unique([area.name, ...(area.aliases ?? [])].map(normalizeAreaName));
  const city = normalizeAreaName(area.city);
  return { neighborhoods, cities: normalizeAreaName(area.name) === city ? [city] : [] };
}

/** SQL mirror of `normalizeAreaName`: lowercase, runs of non-alphanumerics → one space, trimmed. */
export function normalizedSql(value: AnyColumn | SQL): SQL {
  return sql`btrim(regexp_replace(lower(${value}), '[^a-z0-9]+', ' ', 'g'))`;
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
export function areaCondition(area: Pick<Area, "name" | "city" | "aliases">): SQL {
  const keys = areaMatchKeys(area);
  const parts = [normalizedMatch(listings.neighborhood, keys.neighborhoods)];
  if (keys.cities.length) parts.push(normalizedMatch(listings.city, keys.cities));
  return sql`(${sql.join(parts, sql` or `)})`;
}

export type AreaKeyRow = { slug: string; kind: "neighborhood" | "city"; key: string };

/**
 * One row per (area, kind, key) for matching many areas at once: the SQL
 * joins listings to these rows on plain equality, which Postgres can hash,
 * instead of an OR across arrays that forces a nested loop.
 */
export function areaKeyRows(
  list: Pick<Area, "slug" | "name" | "city" | "aliases">[],
): AreaKeyRow[] {
  return list.flatMap((a) => {
    const k = areaMatchKeys(a);
    return [
      ...k.neighborhoods.map((key) => ({ slug: a.slug, kind: "neighborhood" as const, key })),
      ...k.cities.map((key) => ({ slug: a.slug, kind: "city" as const, key })),
    ];
  });
}

/**
 * Normalized names an agent's `serviceAreas` entry may use for this area: the
 * area's own names, or any of its counties ("Franklin County"), since agents
 * in a rural market often describe their territory by county.
 */
export function serviceAreaKeys(
  area: Pick<Area, "name" | "city" | "aliases" | "counties">,
): string[] {
  const keys = areaMatchKeys(area);
  const counties = area.counties.map((c) => normalizeAreaName(`${c} County`));
  return unique([...keys.neighborhoods, ...keys.cities, ...counties]);
}

/**
 * The guide for a listing's location, if we publish one: its neighborhood
 * first ("Lake Hartwell"), then its city ("Royston"). A city without a guide
 * never matches.
 */
export function guideForLocation(
  neighborhood: string | null | undefined,
  city: string | null | undefined,
): Area | undefined {
  return findArea(neighborhood) ?? findArea(city);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}
