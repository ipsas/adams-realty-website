import { describe, expect, it } from "vitest";
import {
  claimedCrawler,
  clientIp,
  ipInList,
  isCrawlerHost,
  isListingDataPath,
  isLoopback,
  isPreviewBot,
  isScraperUserAgent,
  LIMITS,
  limitPlan,
  normalizeIp,
  PAGE_UNITS,
  parseIpList,
  requestKind,
} from "./anti-scraping";

const headers = (h: Record<string, string>) => new Headers(h);

describe("anti-scraping policy", () => {
  it("guards search, listing pages and the location API, not sitemaps or other pages", () => {
    for (const p of ["/homes", "/homes/123-main-st-royston-ga", "/api/locations/suggest"]) {
      expect(isListingDataPath(p), p).toBe(true);
    }
    for (const p of ["/", "/homes/sitemap/0.xml", "/homesick", "/about", "/api/auth/session"]) {
      expect(isListingDataPath(p), p).toBe(false);
    }
  });

  it("refuses HTTP libraries and scrapers, and clients that send no user agent", () => {
    for (const ua of [
      "python-requests/2.32.3",
      "Scrapy/2.11 (+https://scrapy.org)",
      "curl/8.7.1",
      "Wget/1.21",
      "Go-http-client/2.0",
      "axios/1.7.2",
      "node-fetch/1.0",
      "",
      "   ",
      null,
    ]) {
      expect(isScraperUserAgent(ua), String(ua)).toBe(true);
    }
  });

  it("lets browsers, search engines and link previews through", () => {
    for (const ua of [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "facebookexternalhit/1.1",
    ]) {
      expect(isScraperUserAgent(ua), ua).toBe(false);
    }
  });

  it("takes the first x-forwarded-for address, then x-real-ip, else none", () => {
    expect(clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(headers({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(headers({}))).toBeNull();
  });

  it("tells full page loads from the site's own refreshes, prefetches and the API", () => {
    expect(requestKind("GET", "/homes", headers({}))).toBe("page");
    expect(requestKind("HEAD", "/homes/x", headers({}))).toBe("page");
    expect(
      requestKind(
        "GET",
        "/homes",
        headers({ "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }),
      ),
    ).toBe("page");
    // A map move or filter tap: the router's RSC fetch. The proxy never sees `rsc`
    // (Next strips it), but the router's next-url header and the browser's
    // Sec-Fetch-Dest: empty remain.
    expect(requestKind("GET", "/homes", headers({ "next-url": "/homes" }))).toBe("refresh");
    expect(requestKind("GET", "/homes", headers({ "sec-fetch-dest": "empty" }))).toBe("refresh");
    expect(requestKind("GET", "/homes", headers({ rsc: "1" }))).toBe("refresh");
    // A server action on a listing page (save, tour form).
    expect(requestKind("POST", "/homes/x", headers({ "next-action": "abc" }))).toBe("refresh");
    expect(requestKind("POST", "/homes/x", headers({}))).toBe("refresh");
    expect(requestKind("GET", "/homes/x", headers({ "sec-purpose": "prefetch" }))).toBe("prefetch");
    expect(requestKind("GET", "/homes/x", headers({ purpose: "prefetch" }))).toBe("prefetch");
    expect(requestKind("GET", "/homes/x", headers({ "next-router-prefetch": "1" }))).toBe(
      "prefetch",
    );
    expect(requestKind("GET", "/api/locations/suggest", headers({ "next-url": "/" }))).toBe("api");
  });

  it("charges a page load PAGE_UNITS and a client refresh 1, against the same per-IP windows", () => {
    const anon = { kind: "anonymous" } as const;
    expect(limitPlan(anon, "page", "203.0.113.9")).toEqual({
      subject: "203.0.113.9",
      windows: LIMITS.page,
      units: PAGE_UNITS,
    });
    expect(limitPlan(anon, "refresh", "203.0.113.9")).toEqual({
      subject: "203.0.113.9",
      windows: LIMITS.page,
      units: 1,
    });
    expect(PAGE_UNITS).toBeGreaterThanOrEqual(4);
    expect(limitPlan(anon, "prefetch", "203.0.113.9")?.windows).toBe(LIMITS.prefetch);
    expect(limitPlan(anon, "api", "203.0.113.9")?.windows).toBe(LIMITS.api);
  });

  it("limits signed-in buyers per account, never per IP, and not staff, the office, local dev or verified crawlers", () => {
    const member = limitPlan({ kind: "member", userId: "u1" }, "page", "203.0.113.9");
    expect(member).toEqual({ subject: "user:u1", windows: LIMITS.account, units: PAGE_UNITS });
    expect(limitPlan({ kind: "member", userId: "u1" }, "refresh", "x")?.units).toBe(1);
    expect(limitPlan({ kind: "member", userId: "u1" }, "api", "x")?.subject).toBe("user:u1");
    // The account ceiling is well above the per-IP one.
    const perDay = (ws: { ms: number; limit: number }[]) =>
      ws.find((w) => w.ms === 86_400_000)!.limit;
    expect(perDay(LIMITS.account)).toBeGreaterThan(perDay(LIMITS.page) * 2);
    for (const why of ["staff", "office", "local", "crawler"] as const) {
      expect(limitPlan({ kind: "exempt", why }, "page", "203.0.113.9"), why).toBeNull();
    }
    expect(limitPlan({ kind: "preview" }, "page", "203.0.113.9")).toEqual({
      subject: "203.0.113.9",
      windows: LIMITS.preview,
      units: 1,
    });
  });

  it("recognizes link-preview robots, including LinkedIn's (which names an HTTP library)", () => {
    const linkedin =
      "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)";
    expect(isScraperUserAgent(linkedin)).toBe(true);
    for (const ua of [
      linkedin,
      "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
      // iMessage
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_11_1) AppleWebKit/601.2.4 (KHTML, like Gecko) Version/9.0.1 Safari/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0",
      "Twitterbot/1.0",
      "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
      "WhatsApp/2.23.20.0",
    ]) {
      expect(isPreviewBot(ua), ua).toBe(true);
    }
    for (const ua of ["python-requests/2.32.3", "Mozilla/5.0 Chrome/140.0", null, ""]) {
      expect(isPreviewBot(ua), String(ua)).toBe(false);
    }
  });

  it("reads which search engine a crawler claims to be, and which hosts prove it", () => {
    expect(
      claimedCrawler("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"),
    ).toBe("google");
    expect(
      claimedCrawler("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"),
    ).toBe("bing");
    expect(claimedCrawler("Mozilla/5.0 Chrome/140.0")).toBeNull();
    expect(isCrawlerHost("google", "crawl-66-249-66-1.googlebot.com")).toBe(true);
    expect(isCrawlerHost("google", "rate-limited-proxy-66-249-90-77.google.com.")).toBe(true);
    expect(isCrawlerHost("google", "googlebot.com.evil.example")).toBe(false);
    expect(isCrawlerHost("google", "notgooglebot.com")).toBe(false);
    expect(isCrawlerHost("bing", "msnbot-157-55-39-1.search.msn.com")).toBe(true);
    expect(isCrawlerHost("bing", "crawl-66-249-66-1.googlebot.com")).toBe(false);
  });

  it("parses the office allowlist and matches addresses and IPv4 ranges", () => {
    const list = parseIpList(" 203.0.113.5, 198.51.100.0/28 2001:DB8::1, bogus, 1.2.3/8 ");
    expect(list).toEqual(["203.0.113.5", "198.51.100.0/28", "2001:db8::1"]);
    expect(ipInList("203.0.113.5", list)).toBe(true);
    expect(ipInList("::ffff:203.0.113.5", list)).toBe(true);
    expect(ipInList("198.51.100.15", list)).toBe(true);
    expect(ipInList("198.51.100.16", list)).toBe(false);
    expect(ipInList("2001:db8::1", list)).toBe(true);
    expect(ipInList("203.0.113.6", list)).toBe(false);
    expect(parseIpList(undefined)).toEqual([]);
    expect(parseIpList("")).toEqual([]);
    expect(ipInList("203.0.113.5", [])).toBe(false);
  });

  it("knows loopback addresses", () => {
    for (const ip of ["::1", "127.0.0.1", "::ffff:127.0.0.1"])
      expect(isLoopback(ip), ip).toBe(true);
    for (const ip of ["203.0.113.5", "::2"]) expect(isLoopback(ip), ip).toBe(false);
    expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
  });

  it("allows well above what a person browsing does, and far below a bulk download", () => {
    const perMinute = LIMITS.page.find((w) => w.ms === 60_000)!.limit / PAGE_UNITS;
    const perDay = LIMITS.page.find((w) => w.ms === 86_400_000)!.limit / PAGE_UNITS;
    expect(perMinute).toBeGreaterThanOrEqual(60);
    expect(perDay).toBeLessThan(10_000);
    // Every window has its own counter name.
    const names = Object.values(LIMITS).flatMap((ws) => ws.map((w) => w.name));
    expect(new Set(names).size).toBe(names.length);
  });
});
