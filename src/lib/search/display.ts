/**
 * What the results list may claim around its cards. A search that timed out shows what
 * came back, but no total, no numbered pager and no "no homes match": none of those would
 * be true. When a page of results did come back, `steps` still lets the user page on:
 * Previous after page 1, Next when the page came back full (there may be more).
 * `steps` is null when the numbered pager (`pageCount`) applies.
 */
export function resultsDisplay(p: {
  incomplete: boolean;
  total: number | null;
  page: number;
  pageCount: number;
  pageSize: number;
  itemCount: number;
}): {
  total: number | null;
  pageCount: number;
  empty: boolean;
  steps: { prev: boolean; next: boolean } | null;
} {
  const total = p.incomplete ? null : p.total;
  return {
    total,
    pageCount: total === null ? 1 : p.pageCount,
    empty: total !== null && p.itemCount === 0,
    steps:
      total === null && p.itemCount > 0
        ? { prev: p.page > 1, next: p.itemCount >= p.pageSize }
        : null,
  };
}
