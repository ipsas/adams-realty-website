import { describe, expect, it } from "vitest";
import {
  claimedCrawler,
  clientIp,
  ipInList,
  ipLimitSubject,
  ipPlans,
  ipv6Groups,
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

  it("charges a page load PAGE_UNITS; a refresh or prefetch 1, and 1 against the quick cap", () => {
    const anon = { kind: "anonymous" } as const;
    const ip = "203.0.113.9";
    expect(limitPlan(anon, "page", ip)).toEqual([
      { subject: ip, windows: LIMITS.page, units: PAGE_UNITS },
    ]);
    for (const kind of ["refresh", "prefetch"] as const) {
      expect(limitPlan(anon, kind, ip), kind).toEqual([
        { subject: ip, windows: LIMITS.page, units: 1 },
        { subject: ip, windows: LIMITS.quick, units: 1 },
      ]);
    }
    expect(PAGE_UNITS).toBeGreaterThanOrEqual(4);
    expect(limitPlan(anon, "api", ip)).toEqual([{ subject: ip, windows: LIMITS.api, units: 1 }]);
  });

  it("caps what forged refresh or prefetch headers can get at twice the pages a day and an hour", () => {
    // The most full pages one address can load: every quick request it may make (each a
    // forged full page), then plain pages with the units left over.
    const most = (ms: number) => {
      const units = LIMITS.page.find((w) => w.ms === ms)!.limit;
      const quick = LIMITS.quick.find((w) => w.ms === ms)!.limit;
      return quick + (units - quick) / PAGE_UNITS;
    };
    const pagesPer = (ms: number) => LIMITS.page.find((w) => w.ms === ms)!.limit / PAGE_UNITS;
    for (const ms of [3_600_000, 86_400_000]) {
      expect(most(ms), String(ms)).toBeLessThanOrEqual(2 * pagesPer(ms));
    }
    // Still room for a person: a busy hour (60 results pages with 24 prefetches each and
    // 100 listings opened).
    expect(LIMITS.quick.find((w) => w.ms === 3_600_000)!.limit).toBeGreaterThanOrEqual(
      60 * 24 + 100,
    );
    // A link-preview name adds a tenth at most, with an hourly window too.
    const previewDay = LIMITS.preview.find((w) => w.ms === 86_400_000)!.limit;
    expect(previewDay).toBeLessThanOrEqual(pagesPer(86_400_000) / 10);
    expect(LIMITS.preview.some((w) => w.ms === 3_600_000)).toBe(true);
  });

  it("limits signed-in buyers per account and, together, per address; not staff, the office, local dev or verified crawlers", () => {
    const member = { kind: "member", userId: "u1" } as const;
    const ip = "203.0.113.9";
    expect(limitPlan(member, "page", ip)).toEqual([
      { subject: "user:u1", windows: LIMITS.account, units: PAGE_UNITS },
      { subject: ip, windows: LIMITS.members, units: PAGE_UNITS },
    ]);
    expect(limitPlan(member, "refresh", ip)).toEqual([
      { subject: "user:u1", windows: LIMITS.account, units: 1 },
      { subject: "user:u1", windows: LIMITS.accountQuick, units: 1 },
      { subject: ip, windows: LIMITS.members, units: 1 },
      { subject: ip, windows: LIMITS.membersQuick, units: 1 },
    ]);
    expect(limitPlan(member, "api", ip)).toEqual([
      { subject: "user:u1", windows: LIMITS.api, units: 1 },
      { subject: ip, windows: LIMITS.membersApi, units: 1 },
    ]);
    // The account ceiling is well above the per-IP one; the address's members together get
    // an allowance the size of the anonymous one, whatever the number of accounts.
    const perDay = (ws: { ms: number; limit: number }[]) =>
      ws.find((w) => w.ms === 86_400_000)!.limit;
    expect(perDay(LIMITS.account)).toBeGreaterThan(perDay(LIMITS.page) * 2);
    expect(perDay(LIMITS.members)).toBe(perDay(LIMITS.page));
    expect(perDay(LIMITS.membersQuick)).toBe(perDay(LIMITS.quick));
    for (const why of ["staff", "office", "local", "crawler"] as const) {
      expect(limitPlan({ kind: "exempt", why }, "page", ip), why).toEqual([]);
    }
    expect(limitPlan({ kind: "preview" }, "page", ip)).toEqual([
      { subject: ip, windows: LIMITS.preview, units: 1 },
    ]);
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
    // Any Google Cloud VM resolves to *.bc.googleusercontent.com (and back): not a crawler.
    expect(isCrawlerHost("google", "67.45.123.34.bc.googleusercontent.com")).toBe(false);
    expect(isCrawlerHost("google", "10.20.70.34.bc.googleusercontent.com.")).toBe(false);
    expect(isCrawlerHost("google", "x.gae.googleusercontent.com")).toBe(false);
    expect(isCrawlerHost("bing", "msnbot-157-55-39-1.search.msn.com")).toBe(true);
    expect(isCrawlerHost("bing", "crawl-66-249-66-1.googlebot.com")).toBe(false);
  });

  it("reads IPv6 addresses in every written form, and nothing else", () => {
    expect(ipv6Groups("2001:db8:77::1")).toEqual([0x2001, 0xdb8, 0x77, 0, 0, 0, 0, 1]);
    expect(ipv6Groups("2001:DB8:0077:0000:0000:0000:0000:0001")).toEqual(
      ipv6Groups("2001:db8:77::1"),
    );
    expect(ipv6Groups("::1")).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Groups("fe80::1%eth0")).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(ipv6Groups("64:ff9b::192.0.2.33")).toEqual([0x64, 0xff9b, 0, 0, 0, 0, 0xc000, 0x221]);
    expect(ipv6Groups("2001:db8::")).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    for (const bad of [
      "203.0.113.5",
      "1::2::3",
      "2001:db8:1:2:3:4:5",
      "12345::1",
      "g::1",
      "",
      "::ffff:10.0.0.1",
    ])
      expect(ipv6Groups(bad), bad).toBeNull();
  });

  it("counts an IPv6 client by its /64, and by its /48 for the day; IPv4 by its address", () => {
    const MIN = 60_000;
    const DAY = 86_400_000;
    // Every address in one /64 is one client for the minute and hour windows...
    const a = ipLimitSubject("2001:db8:77::1", MIN);
    expect(a).toBe("2001:db8:77:0::/64");
    for (const same of ["2001:db8:77::2", "2001:db8:77:0:dead:beef:1:3", "2001:DB8:77:0::ffff"])
      expect(ipLimitSubject(same, MIN), same).toBe(a);
    expect(ipLimitSubject("2001:db8:77:1::1", MIN)).not.toBe(a);
    // ...and every /64 in one /48 for the day.
    expect(ipLimitSubject("2001:db8:77::1", DAY)).toBe("2001:db8:77::/48");
    expect(ipLimitSubject("2001:db8:77:ffff::9", DAY)).toBe("2001:db8:77::/48");
    expect(ipLimitSubject("2001:db8:78::1", DAY)).not.toBe("2001:db8:77::/48");
    // IPv4, IPv4-mapped IPv6 and anything unreadable: the address itself.
    expect(ipLimitSubject("203.0.113.9", DAY)).toBe("203.0.113.9");
    expect(ipLimitSubject("::ffff:203.0.113.9", MIN)).toBe("203.0.113.9");
    expect(ipLimitSubject("not-an-ip", MIN)).toBe("not-an-ip");
    // One set of windows splits into one counter per subject.
    expect(ipPlans("2001:db8:77::5", LIMITS.page, 4)).toEqual([
      { subject: "2001:db8:77:0::/64", windows: LIMITS.page.filter((w) => w.ms < DAY), units: 4 },
      { subject: "2001:db8:77::/48", windows: LIMITS.page.filter((w) => w.ms >= DAY), units: 4 },
    ]);
    expect(ipPlans("203.0.113.9", LIMITS.page, 4)).toEqual([
      { subject: "203.0.113.9", windows: LIMITS.page, units: 4 },
    ]);
  });

  it("gives an IPv6 client rotating through its /64 no fresh allowance, anonymous or signed in", () => {
    const subjects = (ip: string) =>
      [
        ...limitPlan({ kind: "anonymous" }, "page", ip),
        ...limitPlan({ kind: "anonymous" }, "refresh", ip),
        ...limitPlan({ kind: "anonymous" }, "api", ip),
        ...limitPlan({ kind: "member", userId: "u1" }, "page", ip),
        ...limitPlan({ kind: "member", userId: "u1" }, "api", ip),
        ...limitPlan({ kind: "preview" }, "page", ip),
      ].flatMap((p) => p.windows.map((w) => `${w.name}:${p.subject}`));
    const first = subjects("2001:db8:77::1");
    expect(subjects("2001:db8:77::2")).toEqual(first);
    expect(subjects("2001:db8:77:0:1234:5678:9abc:def0")).toEqual(first);
    expect(first).toContain("page:1m:2001:db8:77:0::/64");
    expect(first).toContain("page:1d:2001:db8:77::/48");
    expect(first).toContain("members:1d:2001:db8:77::/48");
    expect(first).toContain("api:1h:2001:db8:77:0::/64");
    expect(first.some((k) => k.includes("::1"))).toBe(false);
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

  it("takes IPv6 ranges in the office allowlist, since a device changes its IPv6 address often", () => {
    const list = parseIpList(
      "2001:DB8:1:2::/64, 2001:db8:9::/48, 2001:db8::/129, 10.0.0.0/33, a/b/c",
    );
    expect(list).toEqual(["2001:db8:1:2::/64", "2001:db8:9::/48"]);
    expect(ipInList("2001:db8:1:2:aaaa:bbbb:cccc:dddd", list)).toBe(true);
    expect(ipInList("2001:db8:1:3::1", list)).toBe(false);
    expect(ipInList("2001:db8:9:ffff::1", list)).toBe(true);
    expect(ipInList("2001:db8:a::1", list)).toBe(false);
    expect(ipInList("203.0.113.5", list)).toBe(false);
    // Ranges that don't fall on a group boundary.
    expect(ipInList("2001:db8:1:1::1", ["2001:db8:1::/63"])).toBe(true);
    expect(ipInList("2001:db8:1:2::1", ["2001:db8:1::/63"])).toBe(false);
    expect(ipInList("2001:db8:1:3::1", ["2001:db8:1::/62"])).toBe(true);
    expect(ipInList("2001:db8:1:4::1", ["2001:db8:1::/62"])).toBe(false);
    expect(ipInList("198.51.100.15", ["198.51.100.0/28"])).toBe(true);
    expect(ipInList("198.51.100.3", ["0.0.0.0/0"])).toBe(true);
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
