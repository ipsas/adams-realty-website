import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SearchView, type EmptyHelp } from "@/components/search/search-view";
import { site } from "@/config/site";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { mlsDisclaimer } from "@/lib/mls-copyright";
import { gamlsLastSyncedAt } from "@/lib/mls/last-updated";
import { lakeName, searchHeading } from "@/lib/search/heading";
import {
  DEFAULT_CRITERIA,
  describeCriteria,
  parseFromParam,
  parseSearchParams,
  serializeCriteria,
  type SearchCriteria,
  type SearchMode,
  withPageHref,
} from "@/lib/search/params";
import { centerOf, nearbyTowns, placeBounds, resolveScope } from "@/lib/search/place";
import { hasLocation, type LocationScope } from "@/lib/search/query";
import { countListings, MAX_PINS, searchListings, searchMapPins } from "@/lib/search/service";

export async function generateMetadata(props: PageProps<"/homes">): Promise<Metadata> {
  const c = parseSearchParams(await props.searchParams);
  // The unfiltered default search (nothing set but page and sort) leads with the firm's focus;
  // the search itself stays statewide.
  const unfiltered =
    serializeCriteria({ ...c, page: DEFAULT_CRITERIA.page, sort: DEFAULT_CRITERIA.sort }).size ===
    0;
  const { city } = site.market.focus;
  const title = c.q
    ? describeCriteria(c)
    : c.types?.length || c.bounds
      ? // The heading's words: "Land for sale in Georgia", "Homes in this map area".
        searchHeading(c)
      : c.mode === "rent"
        ? `Homes for rent in ${site.coverage.name}`
        : c.mode === "sold"
          ? `Recently sold homes in ${site.coverage.name}`
          : unfiltered
            ? `Homes for sale: ${city} & all of ${site.coverage.name}`
            : `Homes for sale in ${site.coverage.name}`;
  // Only the location/mode version of a search is canonical; filter permutations aren't indexed separately.
  const canonical = serializeCriteria({ mode: c.mode, q: c.q });
  return {
    title,
    // Only the first letter is lowercased, so place names keep their capitals.
    description: unfiltered
      ? `Search homes for sale around ${city} or anywhere in ${site.coverage.name}, from ${site.mls.name}, with the true cost of owning each home and no ads.`
      : `Browse ${title.charAt(0).toLowerCase()}${title.slice(1)} from ${site.mls.name}, with the true cost of owning each home and no ads.`,
    alternates: { canonical: canonical.size ? `/homes?${canonical}` : "/homes" },
    robots: c.bounds || c.page > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function SearchPage(props: PageProps<"/homes">) {
  const raw = await props.searchParams;
  const criteria = parseSearchParams(raw);
  // Whether `q` names a town: looked up once for the list, the pins and the heading.
  const scope = await resolveScope(db, criteria);
  const [results, pins, session, lastSynced] = await Promise.all([
    searchListings(criteria, scope),
    searchMapPins(criteria, scope),
    getSession(),
    gamlsLastSyncedAt(db),
  ]);
  // A page past the last one would show the "no homes match" state: go to the last page.
  if (results.total > 0 && criteria.page > results.pageCount) {
    redirect(withPageHref(raw, results.pageCount));
  }
  // The town a moved map came from, for "Back to Royston" (only while searching the map).
  const from = criteria.bounds && !criteria.q ? parseFromParam(raw) : undefined;

  return (
    <SearchView
      criteria={criteria}
      heading={searchHeading(criteria, scope)}
      place={hasLocation(criteria) ? (scope.town ?? lakeName(criteria.q) ?? criteria.q) : undefined}
      from={from}
      items={results.items}
      total={results.total}
      pageCount={results.pageCount}
      pins={pins}
      maxPins={MAX_PINS}
      signedIn={!!session}
      emptyHelp={results.total === 0 ? await emptyHelp(criteria, scope) : undefined}
      mlsDisclaimer={mlsDisclaimer(lastSynced)}
    />
  );
}

/**
 * What a search with no results offers (site review #5): where the place is, so the map
 * goes there, the nearest towns with homes for this search, and, for a place, what the
 * other modes have there ("Homes for sale in Carnesville" on an empty rentals search).
 */
async function emptyHelp(c: SearchCriteria, scope: LocationScope): Promise<EmptyHelp> {
  const bounds = hasLocation(c) ? await placeBounds(db, c.q, scope) : (c.bounds ?? null);
  const place = hasLocation(c) || !!c.bounds;
  const others: SearchMode[] = c.mode === "buy" ? ["rent"] : ["buy"];
  const [nearby, elsewhere] = await Promise.all([
    bounds ? nearbyTowns(db, c, centerOf(bounds), scope.town ?? c.q) : [],
    place
      ? Promise.all(
          others.map(async (mode) => ({
            mode,
            // The same place and property type; the other filters don't carry over.
            count: await countListings(
              { mode, q: c.q, bounds: c.bounds, types: c.types, sort: "recommended", page: 1 },
              scope,
            ),
          })),
        ).then((rows) => rows.filter((r) => r.count > 0))
      : [],
  ]);
  return { placeBounds: hasLocation(c) ? bounds : null, nearby, elsewhere };
}
