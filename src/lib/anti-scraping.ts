import type { LimitWindow } from "./rate-limit-db";

/**
 * Commercially reasonable protection of Georgia MLS listing data against data
 * mining (IDX agreement §3): the policy `proxy.ts` applies to the routes that
 * serve listings. Pure, so every rule is unit-tested; the counting lives in
 * ./rate-limit-db.ts.
 *
 * - HTTP libraries and scraping frameworks that announce themselves are
 *   refused (403). Search engines and link previews are not: they identify
 *   themselves and follow robots.txt.
 * - Everyone else is rate limited per client IP, well above what a person
 *   browsing does: bursts per minute, sustained use per hour and per day.
 *   Next.js link prefetches get their own, looser bucket, since one results
 *   page can prefetch a couple of dozen listings.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const LIMITS = {
  page: [
    { name: "page:1m", limit: 120, ms: MINUTE },
    { name: "page:1h", limit: 1_500, ms: HOUR },
    { name: "page:1d", limit: 5_000, ms: DAY },
  ],
  prefetch: [
    { name: "prefetch:1m", limit: 600, ms: MINUTE },
    { name: "prefetch:1d", limit: 20_000, ms: DAY },
  ],
  api: [
    { name: "api:1m", limit: 300, ms: MINUTE },
    { name: "api:1h", limit: 5_000, ms: HOUR },
  ],
} satisfies Record<string, LimitWindow[]>;

/** Routes that serve listing data: search, listing pages and the location API. */
export function isListingDataPath(path: string): boolean {
  if (/\.xml$/.test(path)) return false; // sitemaps: slugs only, and crawlers need them
  return path === "/homes" || path.startsWith("/homes/") || path.startsWith("/api/locations/");
}

const SCRAPER_UA =
  /python-requests|python-urllib|aiohttp|httpx|scrapy|curl\/|wget\/|go-http-client|libwww-perl|java\/|okhttp|node-fetch|undici|axios|httpclient|phantomjs|colly|mechanize/i;

/** A client that names itself as an HTTP library or scraper, or names nothing at all. */
export function isScraperUserAgent(ua: string | null | undefined): boolean {
  return !ua?.trim() || SCRAPER_UA.test(ua);
}

type HeaderLike = { get(name: string): string | null };

/**
 * The client's IP. On Vercel `x-forwarded-for` is set by the platform (a
 * client can't forge it); locally there is none, and requests with no IP
 * aren't limited, so dev servers and e2e runs work as before.
 */
export function clientIp(h: HeaderLike): string | null {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || null;
}

/** Which bucket a request counts against. */
export function limitsFor(path: string, h: HeaderLike): LimitWindow[] {
  if (path.startsWith("/api/")) return LIMITS.api;
  const prefetch = h.get("next-router-prefetch") !== null || h.get("purpose") === "prefetch";
  return prefetch ? LIMITS.prefetch : LIMITS.page;
}
