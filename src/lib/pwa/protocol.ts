/**
 * Contract between the page and the service worker (src/sw/sw.ts). No DOM
 * access: the SW imports this file too. Pages are cached per device, so
 * anything user-specific either is never cached or is purged on sign-out and
 * on a user change (CLEAR_USER_DATA).
 */

/** Cache names. Bump `static` only for a format change: hashed assets never go stale. */
export const CACHE_NAMES = {
  /** /_next/static and /vendor, cache-first, LRU. */
  static: "static-v1",
  /** HTML navigations and warmed pages (user data: purged on sign-out). */
  pages: "pages",
  /** Listing photos, cross-origin (purged on sign-out). */
  images: "images",
} as const;

/** Caches that can hold one user's data; deleted by clearUserCaches and CLEAR_USER_DATA. */
export const USER_CACHES = [CACHE_NAMES.pages, CACHE_NAMES.images] as const;

export const LIMITS = {
  staticEntries: 400,
  imageEntries: 100,
  /** Distinct /homes?… query strings kept for offline relaunch. */
  searchPages: 3,
  /** URLs per CACHE_PAGES message. */
  warmPages: 50,
} as const;

export const SW_MESSAGES = {
  /** Page → SW: fetch and store these same-origin, PAGE_ALLOW URLs. */
  CACHE_PAGES: "CACHE_PAGES",
  /** Page → SW: delete the user caches (sign-out, user change). */
  CLEAR_USER_DATA: "CLEAR_USER_DATA",
} as const;

export type SwMessage = { type: "CACHE_PAGES"; urls: string[] } | { type: "CLEAR_USER_DATA" };

export function isSwMessage(data: unknown): data is SwMessage {
  const m = data as SwMessage | null;
  if (m?.type === SW_MESSAGES.CLEAR_USER_DATA) return true;
  return (
    m?.type === SW_MESSAGES.CACHE_PAGES &&
    Array.isArray(m.urls) &&
    m.urls.every((u) => typeof u === "string")
  );
}

/** Same-origin pathnames whose HTML may be cached (network-first). */
export const PAGE_ALLOW: readonly RegExp[] = [
  /^\/$/,
  /^\/homes$/, // search; the SW keeps only LIMITS.searchPages query strings
  /^\/homes\/[\w-]+$/,
  /^\/saved$/,
  /^\/agents$/,
  /^\/agents\/[\w-]+$/,
];

/** Same-origin static assets (cache-first). */
export const STATIC_ALLOW: readonly RegExp[] = [/^\/_next\/static\//, /^\/vendor\//];

/**
 * Same-origin pathnames the SW never intercepts or caches: private or
 * per-session pages, auth flows, APIs (including /api/auth), one-click
 * unsubscribe links and dev tools. Wins over every allow list.
 */
export const NEVER: readonly RegExp[] = [
  /^\/api(\/|$)/,
  /^\/dashboard(\/|$)/,
  /^\/account(\/|$)/,
  /^\/sign-/, // sign-in, sign-up, sign-out
  /^\/(forgot|reset)-password(\/|$)/,
  /^\/alerts(\/|$)/,
  /^\/dev(\/|$)/,
  /^\/_next\/(image|data|webpack-hmr)/,
  /^\/__nextjs/,
];

/** Headers Next.js puts on RSC fetches, prefetches and server actions. */
const NEXT_REQUEST_HEADERS = [
  "rsc",
  "next-router-prefetch",
  "next-router-state-tree",
  "next-action",
];

/** The parts of a Request this module reads (a real Request fits). */
export type RequestLike = {
  method: string;
  url: string;
  headers: { get(name: string): string | null };
};

/**
 * True when the SW must let the request go straight to the network: non-GET
 * (server actions are POSTs), Range requests, RSC payloads (which can carry
 * signed-in data under the page URL), and NEVER paths on our origin.
 */
export function isNeverIntercepted(req: RequestLike, origin: string): boolean {
  if (req.method !== "GET") return true;
  if (req.headers.get("range")) return true;
  if (NEXT_REQUEST_HEADERS.some((h) => req.headers.get(h) !== null)) return true;
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return true;
  }
  if (url.searchParams.has("_rsc")) return true;
  return url.origin === origin && NEVER.some((re) => re.test(url.pathname));
}

/** Whether an HTML page at `url` may be stored in the pages cache. */
export function isCacheablePage(url: string | URL, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  return (
    u.origin === origin &&
    !u.searchParams.has("_rsc") &&
    !NEVER.some((re) => re.test(u.pathname)) &&
    PAGE_ALLOW.some((re) => re.test(u.pathname))
  );
}

/** Whether a same-origin asset belongs in the static cache. */
export function isStaticAsset(url: string | URL, origin: string): boolean {
  let u: URL;
  try {
    u = new URL(url, origin);
  } catch {
    return false;
  }
  return (
    u.origin === origin &&
    !NEVER.some((re) => re.test(u.pathname)) &&
    STATIC_ALLOW.some((re) => re.test(u.pathname))
  );
}
