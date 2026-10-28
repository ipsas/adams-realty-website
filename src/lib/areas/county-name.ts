import { normalizeAreaName } from "@/config/areas";

/**
 * County names and keys. Free of the database, so client components can use
 * them (the county filter); the SQL side is in ./match.ts.
 */

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
  return Array.from(new Set(out));
}

/**
 * County key: "Hart", "HART COUNTY" and "hart county" all → "hart"; the
 * exceptions' variants ("De Kalb", "Mc'Duffie") → "dekalb", "mcduffie".
 */
export function normalizeCounty(county: string): string {
  return joinCountyKey(normalizeAreaName(county).replace(/ county$/, ""));
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
