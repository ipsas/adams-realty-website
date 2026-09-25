import { useMemo } from "react";
import {
  browserStorage,
  type KeyValueStorage,
  readJSON,
  remove,
  STORE_KEYS,
  useLocalValue,
  writeJSON,
} from "@/lib/local-store";
import {
  describeCriteria,
  searchHref,
  type SearchCriteria,
  setViewParam,
  type ViewParam,
} from "./params";

/**
 * Recent searches, the last search (with its sheet view) and recently viewed
 * homes, kept on this device only. Feeds the tab bar's Search link, the home
 * page's "Continue your search" / "Recently viewed" rows, the search panel's
 * "Recent searches" and the installed app's relaunch (via a cookie the server
 * can read). Everything read back is sanitized: storage is user-editable.
 *
 * Functions take optional deps so tests can inject storage, cookies and time.
 */

export const MAX_RECENT_SEARCHES = 8;
export const MAX_RECENTLY_VIEWED = 20;

/**
 * Cookie holding the last search's query string (no "?", including `view`),
 * URI-encoded; Next's cookies() decodes it. /homes?source=pwa redirects to it.
 */
export const LAST_SEARCH_COOKIE = "ar_last_search";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90;
const COOKIE_MAX_CHARS = 1500;

export type RecentSearch = { href: string; label: string; at: number };
type LastSearch = { href: string; at: number };

/** What a listing page records; enough to draw a tile without a server round trip. */
export type ViewedSnapshot = {
  slug: string;
  /** Street line, already "Address withheld by seller" when suppressed. */
  address: string;
  /** "Decatur, GA 30030". */
  cityLine?: string;
  /** Sold price for closed listings, monthly rent for rentals. */
  price: number | null;
  photo: string | null;
  beds: number | null;
  baths: number | null;
  /** IDX: tiles show "Listing by <office>". */
  listOfficeName: string | null;
  transactionType: string;
  status: string;
};
export type ViewedHome = ViewedSnapshot & { viewedAt: number };

export type RecentDeps = {
  storage?: KeyValueStorage | null;
  /** Receives a full Set-Cookie-style string for document.cookie. */
  setCookie?: (cookie: string) => void;
  now?: () => number;
};

function resolve(deps: RecentDeps) {
  return {
    storage: deps.storage === undefined ? browserStorage() : deps.storage,
    setCookie: deps.setCookie ?? writeDocumentCookie,
    now: deps.now ?? Date.now,
  };
}

function writeDocumentCookie(cookie: string) {
  if (typeof document === "undefined") return;
  try {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = cookie + secure;
  } catch {
    // Cookies disabled: relaunch just opens the default search.
  }
}

/** The cookie string for `query` ("q=Decatur&view=list"); deletes it when empty or too long. */
export function lastSearchCookie(query: string): string {
  const value = encodeURIComponent(query);
  if (!value || value.length > COOKIE_MAX_CHARS) {
    return `${LAST_SEARCH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
  return `${LAST_SEARCH_COOKIE}=${value}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax`;
}

/** Only same-origin /homes URLs are ever stored or returned. */
function isSearchHref(href: unknown): href is string {
  return typeof href === "string" && /^\/homes(\?|$)/.test(href) && !/[\s\\#]/.test(href);
}

/** Sets the sheet position; the amenity filter's `view=1` stays. */
function withView(href: string, view: ViewParam | null | undefined): string {
  const url = new URL(href, "http://x");
  setViewParam(url.searchParams, view);
  return url.pathname + url.search;
}

/**
 * Same search, ignoring where the map is, how it's sorted and the sheet
 * position. The amenity filter (`view=1`) is a filter, so it still counts.
 */
function sameSearchKey(href: string): string {
  const url = new URL(href, "http://x");
  for (const k of ["bounds", "sort", "page"]) url.searchParams.delete(k);
  setViewParam(url.searchParams, null);
  url.searchParams.sort();
  return url.search;
}

function toRecentSearches(value: unknown): RecentSearch[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (e): e is RecentSearch =>
        !!e && isSearchHref(e.href) && typeof e.label === "string" && typeof e.at === "number",
    )
    .slice(0, MAX_RECENT_SEARCHES);
}

function toLastSearchHref(value: unknown): string | null {
  const href = (value as LastSearch | null)?.href;
  return isSearchHref(href) ? href : null;
}

const str = (v: unknown): v is string => typeof v === "string";
const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
const safePhoto = (v: unknown) => (str(v) && /^(https?:\/\/|\/(?!\/))/.test(v) ? v : null);

/** Valid entries only; an unusable photo becomes null rather than dropping the home. */
function toRecentlyViewed(value: unknown): ViewedHome[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (e): e is ViewedHome =>
        !!e &&
        str(e.slug) &&
        /^[\w-]+$/.test(e.slug) &&
        str(e.address) &&
        (e.cityLine === undefined || str(e.cityLine)) &&
        numOrNull(e.price) &&
        numOrNull(e.beds) &&
        numOrNull(e.baths) &&
        (e.listOfficeName === null || str(e.listOfficeName)) &&
        str(e.transactionType) &&
        str(e.status) &&
        typeof e.viewedAt === "number",
    )
    .slice(0, MAX_RECENTLY_VIEWED)
    .map((e) => ({ ...e, photo: safePhoto(e.photo) }));
}

/**
 * Records the search on screen: adds it to recent searches (one entry per
 * place + filters; the newest map area and sort win) and makes it the last
 * search, including the sheet `view`, in storage and in the relaunch cookie.
 */
export function recordSearch(
  criteria: SearchCriteria,
  view?: ViewParam | null,
  deps: RecentDeps = {},
): void {
  const { storage, setCookie, now } = resolve(deps);
  const at = now();

  const href = searchHref({ ...criteria, page: 1 });
  // The unfiltered default search isn't worth listing.
  if (href !== "/homes") {
    const key = sameSearchKey(href);
    const rest = readRecentSearches({ storage }).filter(
      (e) => e.href !== href && sameSearchKey(e.href) !== key,
    );
    const entry: RecentSearch = { href, label: describeCriteria(criteria), at };
    writeJSON(STORE_KEYS.recentSearches, [entry, ...rest].slice(0, MAX_RECENT_SEARCHES), storage);
  }

  saveLast(withView(searchHref(criteria), view), at, storage, setCookie);
}

/** Updates the last search's sheet view (after the sheet settles). */
export function setLastSearchView(view: ViewParam | null, deps: RecentDeps = {}): void {
  const { storage, setCookie, now } = resolve(deps);
  const href = lastSearchHref({ storage });
  if (href) saveLast(withView(href, view), now(), storage, setCookie);
}

function saveLast(
  href: string,
  at: number,
  storage: KeyValueStorage | null,
  setCookie: (c: string) => void,
) {
  writeJSON(STORE_KEYS.lastSearch, { href, at } satisfies LastSearch, storage);
  setCookie(lastSearchCookie(new URL(href, "http://x").search.slice(1)));
}

/** Newest first, at most 8. */
export function readRecentSearches(deps: RecentDeps = {}): RecentSearch[] {
  return toRecentSearches(readJSON(STORE_KEYS.recentSearches, null, resolve(deps).storage));
}

/** "/homes?q=Decatur&view=list", or null when nothing was searched on this device. */
export function lastSearchHref(deps: RecentDeps = {}): string | null {
  return toLastSearchHref(readJSON(STORE_KEYS.lastSearch, null, resolve(deps).storage));
}

/** Records a listing view (newest first, one entry per listing, at most 20). */
export function recordView(snapshot: ViewedSnapshot, deps: RecentDeps = {}): void {
  const { storage, now } = resolve(deps);
  const [entry] = toRecentlyViewed([{ ...snapshot, viewedAt: now() }]);
  if (!entry) return;
  const rest = readRecentlyViewed({ storage }).filter((e) => e.slug !== snapshot.slug);
  writeJSON(STORE_KEYS.recentlyViewed, [entry, ...rest].slice(0, MAX_RECENTLY_VIEWED), storage);
}

export function readRecentlyViewed(deps: RecentDeps = {}): ViewedHome[] {
  return toRecentlyViewed(readJSON(STORE_KEYS.recentlyViewed, null, resolve(deps).storage));
}

/** Forgets searches, the last search (and its cookie) and viewed homes. Used on sign-out. */
export function clearRecents(deps: RecentDeps = {}): void {
  const { storage, setCookie } = resolve(deps);
  remove(STORE_KEYS.recentSearches, storage);
  remove(STORE_KEYS.lastSearch, storage);
  remove(STORE_KEYS.recentlyViewed, storage);
  setCookie(lastSearchCookie(""));
}

// Hooks for client components: live (same tab and other tabs), sanitized, and
// empty on the server and during hydration.

export function useRecentSearches(): RecentSearch[] {
  const raw = useLocalValue<unknown>(STORE_KEYS.recentSearches, null);
  return useMemo(() => toRecentSearches(raw), [raw]);
}

export function useLastSearchHref(): string | null {
  const raw = useLocalValue<unknown>(STORE_KEYS.lastSearch, null);
  return useMemo(() => toLastSearchHref(raw), [raw]);
}

export function useRecentlyViewed(): ViewedHome[] {
  const raw = useLocalValue<unknown>(STORE_KEYS.recentlyViewed, null);
  return useMemo(() => toRecentlyViewed(raw), [raw]);
}
