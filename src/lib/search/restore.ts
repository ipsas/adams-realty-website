import {
  browserSessionStorage,
  type KeyValueStorage,
  readJSON,
  SESSION_KEYS,
  writeJSON,
} from "@/lib/local-store";
import { setViewParam } from "./params";

/**
 * Where the buyer was in a results list (F13), kept in this tab's sessionStorage
 * so Back, "Back to results" and a reload of the results page put the list back:
 * the scroll position, the card they tapped (briefly outlined on return) and
 * whether the list or the map was showing. Keyed by the search URL without the
 * sheet position and without `save=` (the heart's sign-in round trip), so
 * switching between list and map, or signing in from a heart, keeps the entry.
 */

export const PLACE_MAX_AGE_MS = 30 * 60 * 1000;

export type SearchPlace = {
  scrollTop: number;
  /** Slug of the card last tapped (opened or hearted), if any. */
  slug: string | null;
  view: "list" | "map";
  savedAt: number;
};

/** "/homes?q=Royston&view=1" for "/homes?q=Royston&view=1&view=map&save=…" (params sorted). */
export function placeKey(pathAndQuery: string): string {
  const url = new URL(pathAndQuery, "http://x");
  setViewParam(url.searchParams, null);
  url.searchParams.delete("save");
  url.searchParams.sort();
  const q = url.searchParams.toString();
  return SESSION_KEYS.searchPlace + url.pathname + (q ? `?${q}` : "");
}

const SLUG = /^[\w-]{1,200}$/;

/** The stored place if it is valid and under 30 minutes old. Storage is user-editable. */
export function readPlace(
  pathAndQuery: string,
  { storage = browserSessionStorage(), now = Date.now() }: PlaceDeps = {},
): SearchPlace | null {
  const v = readJSON<Partial<SearchPlace> | null>(placeKey(pathAndQuery), null, storage);
  if (!v || typeof v !== "object") return null;
  const { scrollTop, slug, view, savedAt } = v;
  if (typeof scrollTop !== "number" || !Number.isFinite(scrollTop) || scrollTop < 0) return null;
  if (typeof savedAt !== "number" || now - savedAt > PLACE_MAX_AGE_MS || savedAt > now + 60_000)
    return null;
  return {
    scrollTop: Math.round(scrollTop),
    slug: typeof slug === "string" && SLUG.test(slug) ? slug : null,
    view: view === "map" ? "map" : "list",
    savedAt,
  };
}

export function writePlace(
  pathAndQuery: string,
  place: Omit<SearchPlace, "savedAt">,
  { storage = browserSessionStorage(), now = Date.now() }: PlaceDeps = {},
): void {
  writeJSON(placeKey(pathAndQuery), { ...place, savedAt: now } satisfies SearchPlace, storage);
}

type PlaceDeps = { storage?: KeyValueStorage | null; now?: number };

/** The listing slug of a same-origin "/homes/<slug>" href, or null. */
export function listingSlugOf(href: string | null | undefined): string | null {
  if (!href) return null;
  try {
    const url = new URL(href, "http://x");
    const sameOrigin =
      url.origin === "http://x" ||
      (typeof window !== "undefined" && url.origin === window.location.origin);
    if (!sameOrigin) return null;
    const m = /^\/homes\/([\w-]+)\/?$/.exec(url.pathname);
    return m && SLUG.test(m[1]) ? m[1] : null;
  } catch {
    return null;
  }
}
