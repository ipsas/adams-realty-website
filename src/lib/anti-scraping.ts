import type { LimitWindow } from "./rate-limit-db";

/**
 * Commercially reasonable protection of Georgia MLS listing data against data
 * mining (IDX agreement §3): the policy `proxy.ts` applies to the routes that
 * serve listings. Pure, so every rule is unit-tested; the counting lives in
 * ./rate-limit-db.ts, crawler checks in ./crawler-verify.ts.
 *
 * - HTTP libraries and scraping frameworks that announce themselves are
 *   refused (403). Link-preview robots (LinkedIn, Facebook, iMessage, X,
 *   Slack…) are allowed to fetch pages, in their own bucket; LinkedIn's names
 *   Apache-HttpClient, which would otherwise read as a library.
 * - Google and Bing crawlers are not limited once reverse and forward DNS
 *   confirm them. A crawler name alone proves nothing: unconfirmed, it is
 *   limited like anyone else.
 * - Staff (agents and admins) and the office's own addresses (`OFFICE_IPS`)
 *   are not limited. Signed-in buyers are limited per account and, all
 *   together, per address, apart from the anonymous allowance, so a busy
 *   shared address (office Wi-Fi, a library, a phone carrier) never locks
 *   them out.
 * - Everyone else is rate limited per client IP, well above what a person
 *   browsing does: bursts per minute, sustained use per hour and per day.
 *   A full page load costs `PAGE_UNITS`; the site's own client-side refreshes
 *   (map moves, filters, other RSC fetches and server actions) and Next.js
 *   link prefetches ("quick" requests) cost 1, against the same windows.
 * - A quick request is recognized by headers a scraper can send too, and a
 *   forged one gets a full page. So quick requests also have their own cap
 *   (`LIMITS.quick`), sized for people (a results page prefetches a couple of
 *   dozen listings): headers can at most double an address's pages a day.
 * - Signed-in buyers on one address share a second allowance of the same size
 *   (`LIMITS.members`), besides each account's own ceiling, so accounts made
 *   from one address (sign-up needs no email check) add one allowance, not
 *   one per account.
 * - Link-preview robots are named by their user agent alone, so their bucket
 *   is small (a preview is one fetch per shared link).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What a full page load costs against the page windows. A client refresh costs 1. */
export const PAGE_UNITS = 4;
const pages = (n: number) => n * PAGE_UNITS;

export const LIMITS = {
  /** Per IP, in units: 120 pages a minute, 1,500 an hour, 5,000 a day. */
  page: [
    { name: "page:1m", limit: pages(120), ms: MINUTE },
    { name: "page:1h", limit: pages(1_500), ms: HOUR },
    { name: "page:1d", limit: pages(5_000), ms: DAY },
  ],
  /**
   * Per IP, in requests: refreshes and prefetches, which cost 1 unit above, capped here
   * too so claiming to be one can't turn the page allowance into 4x the pages. A busy
   * hour of browsing (60 results pages, their prefetches, 100 listings) is about 1,600.
   */
  quick: [
    { name: "quick:1m", limit: 600, ms: MINUTE },
    { name: "quick:1h", limit: 2_000, ms: HOUR },
    { name: "quick:1d", limit: 6_000, ms: DAY },
  ],
  /** Per signed-in buyer, in units: well above any person, still a ceiling for a scraper with an account. */
  account: [
    { name: "account:1m", limit: pages(300), ms: MINUTE },
    { name: "account:1d", limit: pages(20_000), ms: DAY },
  ],
  accountQuick: [
    { name: "account-quick:1h", limit: 4_000, ms: HOUR },
    { name: "account-quick:1d", limit: 20_000, ms: DAY },
  ],
  /**
   * Per IP, every signed-in buyer on it together: the same size as the anonymous
   * allowance, so accounts made from one address can't multiply it.
   */
  members: [
    { name: "members:1m", limit: pages(300), ms: MINUTE },
    { name: "members:1h", limit: pages(1_500), ms: HOUR },
    { name: "members:1d", limit: pages(5_000), ms: DAY },
  ],
  membersQuick: [
    { name: "members-quick:1m", limit: 1_200, ms: MINUTE },
    { name: "members-quick:1h", limit: 2_000, ms: HOUR },
    { name: "members-quick:1d", limit: 6_000, ms: DAY },
  ],
  api: [
    { name: "api:1m", limit: 300, ms: MINUTE },
    { name: "api:1h", limit: 5_000, ms: HOUR },
  ],
  /** The location API for the signed-in buyers on one IP, together. */
  membersApi: [
    { name: "members-api:1m", limit: 300, ms: MINUTE },
    { name: "members-api:1h", limit: 5_000, ms: HOUR },
  ],
  /**
   * Link-preview robots, per IP: one page per shared link. Small, since the user agent
   * alone says it's a preview: it adds a tenth to an address's pages at most.
   */
  preview: [
    { name: "preview:1m", limit: 30, ms: MINUTE },
    { name: "preview:1h", limit: 200, ms: HOUR },
    { name: "preview:1d", limit: 500, ms: DAY },
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

/**
 * Link-preview robots: LinkedIn, Facebook (and iMessage, which sends
 * facebookexternalhit and Twitterbot), X/Twitter, Slack, WhatsApp, Telegram,
 * Discord, Skype/Teams.
 */
const PREVIEW_UA =
  /LinkedInBot|facebookexternalhit|Facebot|Twitterbot|Slackbot|Slack-ImgProxy|WhatsApp|TelegramBot|Discordbot|SkypeUriPreview/i;

export function isPreviewBot(ua: string | null | undefined): boolean {
  return !!ua && PREVIEW_UA.test(ua);
}

export type SearchEngine = "google" | "bing";

/** The search engine a user agent claims to crawl for (unverified), if any. */
export function claimedCrawler(ua: string | null | undefined): SearchEngine | null {
  if (!ua) return null;
  if (/Googlebot|Google-InspectionTool|GoogleOther|Storebot-Google/i.test(ua)) return "google";
  if (/bingbot|BingPreview|msnbot|adidxbot/i.test(ua)) return "bing";
  return null;
}

/**
 * Hostnames the crawlers we recognize (`claimedCrawler`) reverse-resolve to
 * (Google: "Verifying Googlebot"; Bing: "Verifying Bingbot"). Google's common
 * crawlers (Googlebot, GoogleOther, Google-InspectionTool, Storebot) use
 * googlebot.com, its special-case crawlers google.com.
 *
 * Never googleusercontent.com: every Google Cloud VM's address reverse-resolves
 * to `<ip>.bc.googleusercontent.com` and back, so anyone renting a VM would
 * pass (Google lists it only for fetchers that users trigger, which we don't
 * exempt).
 */
export const CRAWLER_DOMAINS: Record<SearchEngine, readonly string[]> = {
  google: ["googlebot.com", "google.com"],
  bing: ["search.msn.com"],
};

export function isCrawlerHost(engine: SearchEngine, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return CRAWLER_DOMAINS[engine].some((d) => h.endsWith(`.${d}`));
}

type HeaderLike = { get(name: string): string | null };

/**
 * The client's IP. On Vercel `x-forwarded-for` is set by the platform (a
 * client can't forge it); `next dev` sets it to the loopback address.
 * Requests with no IP aren't limited.
 */
export function clientIp(h: HeaderLike): string | null {
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || h.get("x-real-ip")?.trim() || null;
}

/** An IPv4-mapped IPv6 address ("::ffff:1.2.3.4") as plain IPv4; IPv6 lowercased. */
export function normalizeIp(ip: string): string {
  const v = ip.trim().toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  return mapped ? mapped[1] : v;
}

export function isLoopback(ip: string): boolean {
  const v = normalizeIp(ip);
  return v === "::1" || v === "localhost" || /^127\./.test(v);
}

const ipv4ToInt = (ip: string): number | null => {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
};

/**
 * Parses an allowlist: comma- or space-separated addresses, IPv4 ranges in
 * CIDR form ("203.0.113.0/28"), exact IPv6 addresses. Bad entries are ignored.
 */
export function parseIpList(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => {
      if (!s) return false;
      const [addr, bits] = s.split("/");
      if (bits !== undefined) return ipv4ToInt(addr) !== null && /^\d+$/.test(bits) && +bits <= 32;
      return ipv4ToInt(addr) !== null || addr.includes(":");
    })
    .map(normalizeIp);
}

export function ipInList(ip: string, list: readonly string[]): boolean {
  const v = normalizeIp(ip);
  const n = ipv4ToInt(v);
  return list.some((entry) => {
    const [addr, bits] = entry.split("/");
    if (bits === undefined) return addr === v;
    const base = ipv4ToInt(addr);
    if (n === null || base === null) return false;
    const size = 2 ** (32 - Number(bits));
    return Math.floor(n / size) === Math.floor(base / size);
  });
}

/**
 * What kind of request this is:
 * - `api`: the location API (autocomplete).
 * - `prefetch`: a prefetch the browser labels (`Sec-Purpose`/`Purpose: prefetch`).
 * - `refresh`: the site's own client-side fetch: an RSC request after a map
 *   move, filter or link tap, a router prefetch, or a server action.
 * - `page`: a full page load (and anything that doesn't say otherwise).
 *
 * Next strips its own flight headers (`rsc`, `next-router-prefetch`, …) and the
 * `_rsc` parameter before the proxy runs, so a client fetch is recognized by
 * what is left: the router's `next-url` header, a server action's
 * `next-action`, or the browser's `Sec-Fetch-Dest: empty` (a script's fetch;
 * a page load says `document`). A scraper can send those too, which is why a
 * refresh still counts (at 1 unit) against the same per-IP windows.
 */
export type RequestKind = "api" | "prefetch" | "refresh" | "page";

export function requestKind(method: string, path: string, h: HeaderLike): RequestKind {
  if (path.startsWith("/api/")) return "api";
  const purpose = h.get("sec-purpose") ?? h.get("purpose");
  if (h.get("next-router-prefetch") !== null || /prefetch/i.test(purpose ?? "")) return "prefetch";
  if (method !== "GET" && method !== "HEAD") return "refresh";
  if (h.get("rsc") === "1" || h.get("next-url") !== null || h.get("next-action") !== null)
    return "refresh";
  if (h.get("sec-fetch-dest") === "empty") return "refresh";
  return "page";
}

/** Who is asking, as far as the limiter cares. */
export type Visitor =
  | { kind: "exempt"; why: "staff" | "office" | "local" | "crawler" }
  | { kind: "member"; userId: string }
  | { kind: "preview" }
  | { kind: "anonymous" };

/** A counter to bump: `subject` (IP or account) against `windows`, `units` at a time. */
export type LimitPlan = { subject: string; windows: LimitWindow[]; units: number };

/**
 * The counters a request counts against (all must have room), or none when it
 * isn't limited. A page costs PAGE_UNITS against the unit windows; a quick
 * request (refresh or prefetch) costs 1 there and 1 against its quick cap.
 */
export function limitPlan(visitor: Visitor, kind: RequestKind, ip: string): LimitPlan[] {
  const spend = (subject: string, units: LimitWindow[], quick: LimitWindow[]): LimitPlan[] =>
    kind === "page"
      ? [{ subject, windows: units, units: PAGE_UNITS }]
      : [
          { subject, windows: units, units: 1 },
          { subject, windows: quick, units: 1 },
        ];
  switch (visitor.kind) {
    case "exempt":
      return [];
    case "member": {
      const user = `user:${visitor.userId}`;
      if (kind === "api") {
        return [
          { subject: user, windows: LIMITS.api, units: 1 },
          { subject: ip, windows: LIMITS.membersApi, units: 1 },
        ];
      }
      return [
        ...spend(user, LIMITS.account, LIMITS.accountQuick),
        ...spend(ip, LIMITS.members, LIMITS.membersQuick),
      ];
    }
    case "preview":
      return [{ subject: ip, windows: LIMITS.preview, units: 1 }];
    case "anonymous":
      if (kind === "api") return [{ subject: ip, windows: LIMITS.api, units: 1 }];
      return spend(ip, LIMITS.page, LIMITS.quick);
  }
}
