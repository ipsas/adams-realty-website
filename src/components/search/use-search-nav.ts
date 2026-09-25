"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { searchHref, type SearchCriteria } from "@/lib/search/params";

/**
 * Updates the search URL (the source of truth) and lets the server re-render
 * results. Any filter change resets to page 1 unless a page is given.
 */
export function useSearchNav(criteria: SearchCriteria) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const update = useCallback(
    (patch: Partial<SearchCriteria>, opts: { replace?: boolean } = {}) => {
      const next: Partial<SearchCriteria> = { ...criteria, ...patch, page: patch.page ?? 1 };
      const href = searchHref(next);
      startTransition(() => {
        if (opts.replace) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [criteria, router],
  );

  return { update, isPending };
}
