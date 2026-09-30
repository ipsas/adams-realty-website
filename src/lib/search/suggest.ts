import { areas, countyLabel, normalizeAreaName } from "@/config/areas";
import { lakeGuide } from "./query";

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
 */

export type Suggestion = {
  kind: "city" | "neighborhood" | "zip" | "address" | "lake";
  label: string;
  sublabel?: string;
  /** Value for the search `q` param, or a slug for addresses. */
  value: string;
  /** Live listings in the place (not for addresses, lakes found by name, or towns with none). */
  count?: number;
};

export type PlaceRow = { kind: string; label: string; sublabel: string | null; n: number };

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
): Suggestion[] {
  const out: Suggestion[] = [];
  const lakes = new Map<string, Suggestion>();
  for (const r of rows) {
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
  const shown = [...out.slice(0, MAX_AREA_SUGGESTIONS - named.length), ...named];
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
