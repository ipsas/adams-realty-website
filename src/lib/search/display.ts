/**
 * What the results list may claim around its cards. A search that timed out shows what
 * came back, but no total, no pager and no "no homes match": none of those would be true.
 */
export function resultsDisplay(p: {
  incomplete: boolean;
  total: number | null;
  pageCount: number;
  itemCount: number;
}): { total: number | null; pageCount: number; empty: boolean } {
  const total = p.incomplete ? null : p.total;
  return {
    total,
    pageCount: total === null ? 1 : p.pageCount,
    empty: total !== null && p.itemCount === 0,
  };
}
