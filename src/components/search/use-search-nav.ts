"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import {
  parseViewParam,
  searchHref,
  setViewParam,
  type SearchCriteria,
  type ViewParam,
} from "@/lib/search/params";

/**
 * The search URL for `criteria` with `patch` applied. Any change resets to
 * page 1 unless the patch sets a page. `view` (the phone sheet position) is
 * appended when given, so filter changes keep the sheet where it was. It sits
 * beside the amenity filter's `view=1` if that is on (`view=1&view=list`).
 */
export function buildSearchHref(
  criteria: SearchCriteria,
  patch: Partial<SearchCriteria>,
  view?: ViewParam | null,
): string {
  const href = searchHref({ ...criteria, ...patch, page: patch.page ?? 1 });
  if (!view) return href;
  return `${href}${href.includes("?") ? "&" : "?"}view=${view}`;
}

/** The sheet position in the current URL's `view` values (client only). */
export function currentView(): ViewParam | undefined {
  if (typeof window === "undefined") return undefined;
  return parseViewParam(new URLSearchParams(window.location.search).getAll("view"));
}

/**
 * Updates the search URL (the source of truth) and lets the server re-render
 * results. update() keeps the current `view`; setView() changes only `view`,
 * in place, without a server request.
 */
export function useSearchNav(criteria: SearchCriteria) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const update = useCallback(
    (patch: Partial<SearchCriteria>, opts: { replace?: boolean } = {}) => {
      const href = buildSearchHref(criteria, patch, currentView());
      startTransition(() => {
        if (opts.replace) router.replace(href, { scroll: false });
        else router.push(href, { scroll: false });
      });
    },
    [criteria, router],
  );

  const setView = useCallback((view: ViewParam | null) => replaceViewParam(view), []);

  return { update, setView, isPending };
}

/**
 * Rewrites the sheet position in the current history entry, keeping the
 * amenity filter's `view=1`. Next.js patches
 * history.replaceState to sync usePathname/useSearchParams without fetching,
 * so this makes no document or RSC request. Other app state on the entry
 * (e.g. a dialog marker) is kept; Next copies its own internal keys back.
 */
export function replaceViewParam(view: ViewParam | null) {
  const url = new URL(window.location.href);
  if ((parseViewParam(url.searchParams.getAll("view")) ?? null) === view) return;
  setViewParam(url.searchParams, view);
  // Handing Next its own keys (__NA) back would make its patch skip the router sync.
  const appState: Record<string, unknown> = { ...(window.history.state ?? {}) };
  delete appState.__NA;
  delete appState.__PRIVATE_NEXTJS_INTERNALS_TREE;
  window.history.replaceState(appState, "", url.pathname + url.search + url.hash);
}
