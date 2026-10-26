import { site } from "@/config/site";
import { normalizeCounty } from "@/lib/areas/match";
import type { PlacesIndexCounty } from "./queries";

/** What /places and the home page's towns show when no town has homes for sale. */
export const NO_HOMES_FOR_SALE = "No homes are for sale right now. Check back soon.";

/** One county block on /places. */
export type PlacesCountyView = PlacesIndexCounty & {
  /** "Franklin County", or "County not listed" for listings with none. */
  label: string;
  /** Anchor id: "franklin-county", "no-county". */
  id: string;
  /** One of the counties the firm serves (its agents tour homes there). */
  firmCounty: boolean;
  /** Homes for sale across the county's towns. */
  homes: number;
};

export type PlacesIndexView = {
  counties: PlacesCountyView[];
  /** Distinct towns (a town spanning counties counts once). */
  towns: number;
  homes: number;
  /** First letters of the named counties, A–Z, for the jump links. */
  letters: string[];
};

const FIRM_COUNTIES = new Set(site.market.counties.map(normalizeCounty));

/**
 * Shapes `getPlacesIndex` rows for the statewide places index: labels,
 * anchors, per-county totals, the firm's counties marked, and the letters
 * the jump links need. Pure, so the page's numbers are unit-tested.
 */
export function placesIndexView(groups: PlacesIndexCounty[]): PlacesIndexView {
  const counties = groups.map((g) => {
    const name = g.county?.replace(/\s+county$/i, "").trim() || null;
    return {
      ...g,
      label: name ? `${name} County` : "County not listed",
      id: name ? `${slugify(name)}-county` : "no-county",
      firmCounty: !!name && FIRM_COUNTIES.has(normalizeCounty(name)),
      homes: g.cities.reduce((n, c) => n + c.count, 0),
    };
  });
  const towns = new Set(groups.flatMap((g) => g.cities.map((c) => c.city.toLowerCase())));
  const letters = [
    ...new Set(counties.filter((c) => c.county).map((c) => c.label[0].toUpperCase())),
  ].sort();
  return {
    counties,
    towns: towns.size,
    homes: counties.reduce((n, c) => n + c.homes, 0),
    letters,
  };
}

/** The first county block for each letter carries the letter's anchor ("letter-f"). */
export function letterAnchors(counties: PlacesCountyView[]): Map<string, string> {
  const out = new Map<string, string>();
  const seen = new Set<string>();
  for (const c of counties) {
    if (!c.county) continue;
    const letter = c.label[0].toLowerCase();
    if (seen.has(letter)) continue;
    seen.add(letter);
    out.set(c.id, `letter-${letter}`);
  }
  return out;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
