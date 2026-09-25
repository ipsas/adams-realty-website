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
      ? `Homes for rent in ${site.market.name}`
      : `Homes for sale in ${site.market.name}`;
  // Only the location/mode version of a search is canonical; filter permutations aren't indexed separately.
  const canonical = serializeCriteria({ mode: c.mode, q: c.q });
  return {
    title,
    description: `Browse ${title.toLowerCase()} with listings from ${site.mls.name}, honest monthly cost estimates and local agents.`,
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
