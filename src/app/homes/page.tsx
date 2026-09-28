import type { Metadata } from "next";
import { SearchView } from "@/components/search/search-view";
import { site } from "@/config/site";
import { getSession } from "@/lib/auth/session";
import { describeCriteria, parseSearchParams, serializeCriteria } from "@/lib/search/params";
import { MAX_PINS, searchListings, searchMapPins } from "@/lib/search/service";

export async function generateMetadata(props: PageProps<"/homes">): Promise<Metadata> {
  const c = parseSearchParams(await props.searchParams);
  const title = c.q
    ? describeCriteria(c)
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
  const criteria = parseSearchParams(await props.searchParams);
  const [results, pins, session] = await Promise.all([
    searchListings(criteria),
    searchMapPins(criteria),
    getSession(),
  ]);

  return (
    <SearchView
      criteria={criteria}
      items={results.items}
      total={results.total}
      pageCount={results.pageCount}
      pins={pins}
      maxPins={MAX_PINS}
      signedIn={!!session}
    />
  );
}
