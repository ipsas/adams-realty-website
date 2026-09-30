import type { Metadata } from "next";
import { SearchView, type EmptyHelp } from "@/components/search/search-view";
import { site } from "@/config/site";
import { db } from "@/db";
import { getSession } from "@/lib/auth/session";
import { lakeName, searchHeading } from "@/lib/search/heading";
import {
  describeCriteria,
  parseFromParam,
  parseSearchParams,
  serializeCriteria,
  type SearchCriteria,
} from "@/lib/search/params";
import { centerOf, nearbyTowns, placeBounds, resolveScope } from "@/lib/search/place";
import { hasLocation, type LocationScope } from "@/lib/search/query";
import { MAX_PINS, searchListings, searchMapPins } from "@/lib/search/service";

export async function generateMetadata(props: PageProps<"/homes">): Promise<Metadata> {
  const c = parseSearchParams(await props.searchParams);
  const title = c.q
    ? describeCriteria(c)
    : c.types?.length || c.bounds
      ? // The heading's words: "Land for sale in Georgia", "Homes in this map area".
        searchHeading(c)
      : c.mode === "rent"
        ? `Homes for rent in ${site.coverage.name}`
        : c.mode === "sold"
          ? `Recently sold homes in ${site.coverage.name}`
          : `Homes for sale in ${site.coverage.name}`;
  // Only the location/mode version of a search is canonical; filter permutations aren't indexed separately.
  const canonical = serializeCriteria({ mode: c.mode, q: c.q });
  return {
    title,
    // Only the first letter is lowercased, so place names keep their capitals.
    description: `Browse ${title.charAt(0).toLowerCase()}${title.slice(1)} from ${site.mls.name}, with the true cost of owning each home and no ads.`,
    alternates: { canonical: canonical.size ? `/homes?${canonical}` : "/homes" },
    robots: c.bounds || c.page > 1 ? { index: false, follow: true } : undefined,
  };
}

export default async function SearchPage(props: PageProps<"/homes">) {
  const raw = await props.searchParams;
  const criteria = parseSearchParams(raw);
  // Whether `q` names a town: looked up once for the list, the pins and the heading.
  const scope = await resolveScope(db, criteria);
  const [results, pins, session] = await Promise.all([
    searchListings(criteria, scope),
    searchMapPins(criteria, scope),
    getSession(),
  ]);
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
    />
  );
}

/**
 * What a search with no results offers (site review #5): where the place is, so the map
 * goes there, and the nearest towns with homes for this search.
 */
async function emptyHelp(c: SearchCriteria, scope: LocationScope): Promise<EmptyHelp> {
  const bounds = hasLocation(c) ? await placeBounds(db, c.q, scope) : (c.bounds ?? null);
  const nearby = bounds ? await nearbyTowns(db, c, centerOf(bounds), scope.town ?? c.q) : [];
  return { placeBounds: hasLocation(c) ? bounds : null, nearby };
}
