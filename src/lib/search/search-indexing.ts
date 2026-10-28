import type { Metadata } from "next";
import { serializeCriteria, type SearchCriteria } from "./params";

/**
 * Indexing for a /homes search: only the bare search is indexed. Any criterion (location,
 * filter, sort, page, map area) gives noindex,follow, with the canonical pointing at the
 * normalised URL of that exact search.
 */
export function searchPageIndexing(c: SearchCriteria): {
  canonical: string;
  robots: Metadata["robots"];
} {
  const query = serializeCriteria(c);
  return query.size
    ? { canonical: `/homes?${query}`, robots: { index: false, follow: true } }
    : { canonical: "/homes", robots: undefined };
}
