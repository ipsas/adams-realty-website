import { areas, countyLabel, normalizeAreaName } from "@/config/areas";
import { countyDisplay, joinCountyKey, normalizeCounty } from "@/lib/areas/match";
import { lakeGuide, stripPartialState } from "./query";

/**
 * Shapes location autocomplete (site review #5). Pure, so the rules are
 * unit-tested; `getLocationSuggestions` (src/lib/listings/queries.ts) feeds it.
 *
 * - A lake is one suggestion, "Lake Hartwell (lake area)", however many towns
 *   its homes are in: the places view has a "Lake Hartwell" neighborhood row
 *   per town (Hartwell, Lavonia, Toccoa), which used to show three times.
 * - A lake guide is offered whenever the text starts one of its names, so
 *   typing "Hartwell" offers both the town and the lake.
 * - Towns with no homes listed right now (only past sales) still appear, after
 *   the rest, so a search for one reaches the no-results helpers instead of
 *   looking unknown.
 * - Counties ("Hall" tagged "County", value "Hall County", from the listings'
 *   counties) come before the places: first the one the text names ("Hall",
 *   "Hall Co"), then the others it starts ("Clay": Clay, then Clayton County,
 *   then the town of Clayton); a neighborhood a feed named after a county
 *   ("Hall County" in Clermont) is dropped.
 */

export type Suggestion = {
  kind: "city" | "county" | "neighborhood" | "zip" | "address" | "lake";
  label: string;
  sublabel?: string;
  /** Value for the search `q` param, or a slug for addresses. */
  value: string;
  /** Live listings in the place (not for addresses, lakes found by name, or towns with none). */
  count?: number;
};

export type PlaceRow = { kind: string; label: string; sublabel: string | null; n: number };

/** A county with live listings, as a feed spells it ("HALL"), and how many. */
export type CountyRow = { county: string; n: number };

/**
 * The county name typed so far, for the county lookup: "Hall Co", "hall county, GA",
 * "Hall County, G" → "hall"; "Gwin" → "gwin"; "De Ka" → "deka". Empty when
 * there's nothing to look up.
 */
export function countyPrefix(term: string): string {
  const t = normalizeAreaName(stripPartialState(term)).replace(/ (ga|georgia)$/, "");
  if (/^\d/.test(t)) return "";
  return joinCountyKey(t.replace(/ c(o(u(n(t(y)?)?)?)?)?$/, ""));
}

/** Area suggestions shown at most (addresses come after). */
export const MAX_AREA_SUGGESTIONS = 6;

/** The lake a place name is: a lake guide's name ("Lanier" → "Lake Lanier"), or any "Lake …". */
export function lakeOf(label: string): string | undefined {
  const guide = lakeGuide(label);
  if (guide) return guide.name;
  return /^lake\s/i.test(label.trim()) ? label.trim() : undefined;
}

const LAKE_GUIDES = areas.filter((a) => lakeGuide(a.name));

/** Lake guides one of whose names (or a word in it) starts with the typed text. */
export function lakeGuidesMatching(term: string) {
  const t = normalizeAreaName(term);
  if (t.length < 2) return [];
  return LAKE_GUIDES.filter((a) =>
    [a.name, ...(a.aliases ?? [])].some((name) => {
      const n = normalizeAreaName(name);
      return n.startsWith(t) || n.includes(` ${t}`);
    }),
  );
}

function lakeSuggestion(name: string, count?: number): Suggestion {
  const guide = lakeGuide(name);
  return {
    kind: "lake",
    label: `${name} (lake area)`,
    sublabel: guide ? countyLabel(guide) : "Lake area",
    value: name,
    count,
  };
}

export function shapeAreaSuggestions(
  term: string,
  rows: PlaceRow[],
  pastOnlyCities: string[] = [],
  countyRows: CountyRow[] = [],
): Suggestion[] {
  const out: Suggestion[] = [];
  const lakes = new Map<string, Suggestion>();
  const typed = countyPrefix(term);
  // The name once, tagged "County"; choosing it searches "Hall County".
  const counties = countyRows.map((r): Suggestion => {
    const value = countyDisplay(r.county);
    const label = value.replace(/ County$/, "");
    return { kind: "county", label, sublabel: "County", value, count: r.n };
  });
  const countyLabels = new Set(counties.map((s) => normalizeAreaName(s.value)));
  // Typed as the county's name ("Hall") or "<name> c…" ("Hall Co"): that county comes first.
  const exact = (s: Suggestion) => typed === normalizeCounty(s.value);
  for (const r of rows) {
    // The county itself, not a subdivision a feed named "Hall County".
    if (r.kind === "neighborhood" && countyLabels.has(normalizeAreaName(r.label))) continue;
    const lake = r.kind === "neighborhood" ? lakeOf(r.label) : undefined;
    if (lake) {
      const seen = lakes.get(lake);
      if (seen) seen.count = (seen.count ?? 0) + r.n;
      else {
        const s = lakeSuggestion(lake, r.n);
        lakes.set(lake, s);
        out.push(s);
      }
      continue;
    }
    out.push({
      kind: r.kind as Suggestion["kind"],
      label: r.label,
      sublabel:
        r.kind === "zip"
          ? (r.sublabel ?? undefined)
          : r.kind === "neighborhood"
            ? `Neighborhood in ${r.sublabel}`
            : (r.sublabel ?? undefined),
      value: r.label,
      count: r.n,
    });
  }
  // Lakes found by name always make the list: the busiest places give way to them.
  const named = lakeGuidesMatching(term)
    .filter((guide) => !lakes.has(guide.name))
    .map((guide) => lakeSuggestion(guide.name));
  const ranked = [...counties.filter(exact), ...counties.filter((s) => !exact(s)), ...out];
  const shown = [...ranked.slice(0, MAX_AREA_SUGGESTIONS - named.length), ...named];
  const cities = new Set(
    shown.filter((s) => s.kind === "city").map((s) => normalizeAreaName(s.label)),
  );
  for (const city of pastOnlyCities) {
    if (cities.has(normalizeAreaName(city))) continue;
    cities.add(normalizeAreaName(city));
    shown.push({ kind: "city", label: city, sublabel: "No homes listed right now", value: city });
  }
  return shown.slice(0, MAX_AREA_SUGGESTIONS);
}
