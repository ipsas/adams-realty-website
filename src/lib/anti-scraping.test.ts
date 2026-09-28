import { describe, expect, it } from "vitest";
import {
  clientIp,
  isListingDataPath,
  isScraperUserAgent,
  LIMITS,
  limitsFor,
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

  it("counts pages, prefetches and the API in separate buckets", () => {
    expect(limitsFor("/homes", headers({}))).toBe(LIMITS.page);
    expect(limitsFor("/homes/x", headers({ "next-router-prefetch": "1" }))).toBe(LIMITS.prefetch);
    expect(limitsFor("/api/locations/suggest", headers({}))).toBe(LIMITS.api);
  });

  it("allows well above what a person browsing does, and far below a bulk download", () => {
    const perMinute = LIMITS.page.find((w) => w.ms === 60_000)!.limit;
    const perDay = LIMITS.page.find((w) => w.ms === 86_400_000)!.limit;
    expect(perMinute).toBeGreaterThanOrEqual(60);
    expect(perDay).toBeLessThan(10_000);
    // Every window has its own counter name.
    const names = Object.values(LIMITS).flatMap((ws) => ws.map((w) => w.name));
    expect(new Set(names).size).toBe(names.length);
  });
});
