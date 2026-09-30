import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { LIMITS, PAGE_UNITS } from "./anti-scraping";
import type { ProxyUser } from "./auth/proxy-session";
import { guardListingData, type GuardDeps } from "./listing-guard";
import type { LimitResult, LimitWindow } from "./rate-limit-db";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";
const LINKEDIN =
  "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const IP = "203.0.113.20";

type Hit = { subject: string; windows: LimitWindow[]; units: number };

function setup(over: Partial<GuardDeps> & { over?: boolean } = {}) {
  const hits: Hit[] = [];
  const { over: exceeded, ...rest } = over;
  const deps: GuardDeps = {
    hit: vi.fn(async (subject, windows, units): Promise<LimitResult> => {
      hits.push({ subject, windows, units });
      return exceeded
        ? { ok: false, retryAfter: 42, exceeded: windows[0].name }
        : { ok: true, retryAfter: 0, exceeded: null };
    }),
    user: async () => null,
    verifyCrawler: async () => false,
    officeIps: [],
    production: true,
    ...rest,
  };
  return { deps, hits };
}

function req(
  path: string,
  { ua = CHROME, ip = IP, method = "GET", headers = {} as Record<string, string> } = {},
) {
  const h: Record<string, string> = { ...headers };
  if (ua) h["user-agent"] = ua;
  if (ip) h["x-forwarded-for"] = ip;
  return new NextRequest(`http://localhost${path}`, { method, headers: h });
}

describe("the listing guard", () => {
  it("counts a browser's page load at full weight against its IP, and lets it through", async () => {
    const { deps, hits } = setup();
    expect(await guardListingData(req("/homes"), deps)).toBeNull();
    expect(hits).toEqual([{ subject: IP, windows: LIMITS.page, units: PAGE_UNITS }]);
  });

  it("counts the site's own map, filter and form refreshes at a quarter of a page, and against the quick cap", async () => {
    const { deps, hits } = setup();
    await guardListingData(
      req("/homes?bounds=1,2,3,4", { headers: { "next-url": "/homes" } }),
      deps,
    );
    await guardListingData(
      req("/homes/x", { method: "POST", headers: { "next-action": "a" } }),
      deps,
    );
    expect(hits.map((h) => [h.windows, h.units])).toEqual([
      [LIMITS.page, 1],
      [LIMITS.quick, 1],
      [LIMITS.page, 1],
      [LIMITS.quick, 1],
    ]);
  });

  it("a forged refresh header past the quick cap is paused, though page units remain", async () => {
    const deps: GuardDeps = {
      ...setup().deps,
      hit: async (_subject, windows) =>
        windows === LIMITS.quick
          ? { ok: false, retryAfter: 3_000, exceeded: "quick:1h" }
          : { ok: true, retryAfter: 0, exceeded: null },
    };
    const res = await guardListingData(req("/homes", { headers: { "next-url": "/homes" } }), deps);
    expect(res?.status).toBe(429);
    expect(res?.headers.get("retry-after")).toBe("3000");
    // A plain page load still has page units: it isn't a quick request.
    expect(await guardListingData(req("/homes"), deps)).toBeNull();
  });

  it("refuses HTTP libraries with a 403 and counts nothing", async () => {
    const { deps, hits } = setup();
    const res = await guardListingData(req("/homes", { ua: "python-requests/2.32" }), deps);
    expect(res?.status).toBe(403);
    expect(hits).toEqual([]);
  });

  it("lets LinkedIn's preview robot fetch a listing page, in its own small bucket, but not the API", async () => {
    const { deps, hits } = setup();
    expect(await guardListingData(req("/homes/123-main-st", { ua: LINKEDIN }), deps)).toBeNull();
    expect(hits).toEqual([{ subject: IP, windows: LIMITS.preview, units: 1 }]);
    const api = await guardListingData(req("/api/locations/suggest?q=Roy", { ua: LINKEDIN }), deps);
    expect(api?.status).toBe(403);
  });

  it("doesn't limit staff, and limits signed-in buyers per account and, together, per address", async () => {
    const staff = setup({
      user: async (): Promise<ProxyUser> => ({ userId: "a1", role: "agent" }),
    });
    expect(await guardListingData(req("/homes"), staff.deps)).toBeNull();
    expect(staff.hits).toEqual([]);

    const admin = setup({
      over: true,
      user: async (): Promise<ProxyUser> => ({ userId: "a2", role: "admin" }),
    });
    expect(await guardListingData(req("/homes"), admin.deps)).toBeNull();

    const buyer = setup({
      user: async (): Promise<ProxyUser> => ({ userId: "b1", role: "user" }),
    });
    expect(await guardListingData(req("/homes"), buyer.deps)).toBeNull();
    expect(buyer.hits).toEqual([
      { subject: "user:b1", windows: LIMITS.account, units: PAGE_UNITS },
      { subject: IP, windows: LIMITS.members, units: PAGE_UNITS },
    ]);
    // Their address's anonymous allowance is not theirs: a buyer isn't paused by it.
    expect(buyer.hits.some((h) => h.windows === LIMITS.page)).toBe(false);
  });

  it("doesn't limit the office's addresses", async () => {
    const { deps, hits } = setup({ over: true, officeIps: ["203.0.113.16/28"] });
    expect(await guardListingData(req("/homes"), deps)).toBeNull();
    expect(hits).toEqual([]);
  });

  it("doesn't limit loopback in development, but does in production", async () => {
    const dev = setup({ over: true, production: false });
    expect(await guardListingData(req("/homes", { ip: "::1" }), dev.deps)).toBeNull();
    expect(dev.hits).toEqual([]);
    const prod = setup({ over: true, production: true });
    expect((await guardListingData(req("/homes", { ip: "::1" }), prod.deps))?.status).toBe(429);
  });

  it("lets a DNS-verified Googlebot through uncounted; an unverified one is limited like anyone", async () => {
    const verified = setup({
      over: true,
      verifyCrawler: async (ip, engine) => ip === IP && engine === "google",
    });
    expect(await guardListingData(req("/homes/x", { ua: GOOGLEBOT }), verified.deps)).toBeNull();
    expect(verified.hits).toEqual([]);

    const fake = setup({ over: true, verifyCrawler: async () => false });
    const res = await guardListingData(req("/homes/x", { ua: GOOGLEBOT }), fake.deps);
    expect(res?.status).toBe(429);
    expect(fake.hits[0]).toEqual({ subject: IP, windows: LIMITS.page, units: PAGE_UNITS });
  });

  it("over the limit, a page (or a client refresh) gets the branded 429 page", async () => {
    for (const r of [
      req("/homes?q=Royston"),
      req("/homes?q=Royston&_rsc=x", { headers: { "next-url": "/homes" } }),
    ]) {
      const { deps } = setup({ over: true });
      const res = (await guardListingData(r, deps))!;
      expect(res.status).toBe(429);
      expect(res.headers.get("retry-after")).toBe("42");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("content-type")).toContain("text/html");
      const html = await res.text();
      expect(html).toContain("One moment, please");
      expect(html).toContain('href="/homes?q=Royston" data-testid="busy-retry"');
    }
  });

  it("over the limit, the API and prefetches get plain text", async () => {
    const { deps } = setup({ over: true });
    const api = (await guardListingData(req("/api/locations/suggest?q=R"), deps))!;
    expect(api.status).toBe(429);
    expect(api.headers.get("content-type")).toContain("text/plain");
    const prefetch = (await guardListingData(
      req("/homes/x", { headers: { "next-router-prefetch": "1" } }),
      deps,
    ))!;
    expect(prefetch.status).toBe(429);
    expect(prefetch.headers.get("content-type")).toContain("text/plain");
  });

  it("lets the request through when the database or the session lookup fails", async () => {
    const broken = setup({
      hit: async () => {
        throw new Error("db down");
      },
      user: async () => {
        throw new Error("db down");
      },
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await guardListingData(req("/homes"), broken.deps)).toBeNull();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("counts an IPv6 client by its /64 (its /48 for the day), wherever in it the request comes from", async () => {
    const { deps, hits } = setup();
    for (const ip of ["2001:db8:77::1", "2001:db8:77::2", "2001:db8:77:0:abcd::3"]) {
      expect(await guardListingData(req("/homes", { ip }), deps)).toBeNull();
    }
    const keys = hits.flatMap((h) => h.windows.map((w) => `${w.name}:${h.subject}`));
    expect(new Set(keys)).toEqual(
      new Set([
        "page:1m:2001:db8:77:0::/64",
        "page:1h:2001:db8:77:0::/64",
        "page:1d:2001:db8:77::/48",
      ]),
    );
    expect(keys).toHaveLength(9);
  });

  it("tells a paused signed-in buyer which allowance ran out: their account's, or their connection's", async () => {
    const buyer = async (): Promise<ProxyUser> => ({ userId: "b1", role: "user" });
    const overFor = (subject: (s: string) => boolean) =>
      setup({
        user: buyer,
        hit: async (s, windows) =>
          subject(s)
            ? { ok: false, retryAfter: 5_000, exceeded: windows[0].name }
            : { ok: true, retryAfter: 0, exceeded: null },
      });
    const byAccount = await guardListingData(req("/homes"), overFor((s) => s === "user:b1").deps);
    expect(byAccount?.status).toBe(429);
    const accountHtml = await byAccount!.text();
    expect(accountHtml).toContain("page requests from your account");
    expect(accountHtml).not.toContain("shares one allowance");

    const byAddress = await guardListingData(req("/homes"), overFor((s) => s === IP).deps);
    expect(byAddress?.status).toBe(429);
    const addressHtml = await byAddress!.text();
    expect(addressHtml).toContain("page requests from your internet connection");
    expect(addressHtml).toContain("Everyone signed in on this connection shares one allowance.");
    expect(addressHtml).not.toContain("your account");
    expect(addressHtml).not.toContain("/sign-in");
  });

  it("doesn't count requests with no client IP", async () => {
    const { deps, hits } = setup({ over: true });
    expect(await guardListingData(req("/homes", { ip: "" }), deps)).toBeNull();
    expect(hits).toEqual([]);
  });
});
