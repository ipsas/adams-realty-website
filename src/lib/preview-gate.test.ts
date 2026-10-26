import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AlertsLayout from "@/app/(alerts)/layout";
import robots from "@/app/robots";
import { SiteFooter } from "@/components/layout/site-footer";
import { SiteMain } from "@/components/layout/site-main";
import { env } from "@/lib/env";
import { config, proxy } from "@/proxy";
import {
  isApiPath,
  isPageRequest,
  isPreviewExemptPath,
  PREVIEW_COOKIE,
  previewGate,
  previewNext,
  previewPassword,
  previewPasswordMatches,
  previewToken,
  previewUrl,
  standsAlone,
  verifyPreviewToken,
} from "./preview-gate";
import { hitRateLimits } from "./rate-limit-db";
import { safeNext } from "./safe-redirect";

// The proxy's database work, so a test can see that none happens (and none is attempted).
vi.mock("./rate-limit-db", () => ({
  hitRateLimits: vi.fn(async () => ({ ok: true, retryAfter: 0, exceeded: null })),
}));

const SECRET = "test-secret-test-secret-test-secret-0000";
const PASSWORD = "dogwood-spring";
const CHROME = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36";

beforeEach(() => vi.mocked(hitRateLimits).mockClear());
afterEach(() => vi.unstubAllEnvs());

/** Every element type in a rendered tree (server components left unrendered). */
function elementTypes(node: ReactNode): unknown[] {
  if (Array.isArray(node)) return node.flatMap(elementTypes);
  if (!isValidElement<{ children?: ReactNode }>(node)) return [];
  return [node.type, ...elementTypes(node.props.children)];
}

describe("the preview password and cookie", () => {
  it("is off when PREVIEW_PASSWORD is unset, empty or blank, and ignores surrounding spaces", () => {
    expect(previewPassword({})).toBeNull();
    expect(previewPassword({ PREVIEW_PASSWORD: "" })).toBeNull();
    expect(previewPassword({ PREVIEW_PASSWORD: "   " })).toBeNull();
    expect(previewPassword({ PREVIEW_PASSWORD: " dogwood " })).toBe("dogwood");
  });

  it("accepts the cookie made from the right password", async () => {
    const token = await previewToken(PASSWORD, SECRET);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await verifyPreviewToken(token, PASSWORD, SECRET)).toBe(true);
  });

  it("refuses a cookie made from a wrong password", async () => {
    const token = await previewToken("dogwood-summer", SECRET);
    expect(await verifyPreviewToken(token, PASSWORD, SECRET)).toBe(false);
  });

  it("refuses a tampered, truncated, padded or malformed cookie", async () => {
    const token = await previewToken(PASSWORD, SECRET);
    const flipped = (token[0] === "a" ? "b" : "a") + token.slice(1);
    for (const bad of [
      flipped,
      token.slice(0, 63),
      `${token}0`,
      token.toUpperCase(),
      `${token.slice(0, 62)}zz`,
      "",
      null,
      undefined,
    ]) {
      expect(await verifyPreviewToken(bad, PASSWORD, SECRET), String(bad)).toBe(false);
    }
  });

  it("signs everyone out when the password changes (or the auth secret does)", async () => {
    const before = await previewToken(PASSWORD, SECRET);
    expect(await verifyPreviewToken(before, "dogwood-autumn", SECRET)).toBe(false);
    expect(await verifyPreviewToken(before, PASSWORD, `${SECRET}-rotated`)).toBe(false);
  });

  it("checks what someone typed, ignoring the spaces a phone adds", async () => {
    expect(await previewPasswordMatches(PASSWORD, PASSWORD, SECRET)).toBe(true);
    expect(await previewPasswordMatches(` ${PASSWORD} `, PASSWORD, SECRET)).toBe(true);
    expect(await previewPasswordMatches("Dogwood-Spring", PASSWORD, SECRET)).toBe(false);
    expect(await previewPasswordMatches("dogwood", PASSWORD, SECRET)).toBe(false);
    expect(await previewPasswordMatches("", PASSWORD, SECRET)).toBe(false);
  });
});

describe("what the gate leaves open", () => {
  it("exempts the coming-soon page, cron, robots.txt and the public icons, logos and photos", () => {
    for (const p of [
      "/preview",
      "/api/cron/sync",
      "/api/cron/alerts",
      "/robots.txt",
      "/icon.svg",
      "/favicon.ico",
      "/brand/gamls_idx.png",
      "/team/andrea-anderegg.webp",
      "/_next/static/chunks/app.js",
      "/alerts/one-click",
      "/alerts/unsubscribe",
    ]) {
      expect(isPreviewExemptPath(p), p).toBe(true);
    }
  });

  it("gates everything else, lookalikes included", () => {
    for (const p of [
      "/",
      "/homes",
      "/homes/1204-dogwood-ln-royston-ga-30662-a1b2c3d",
      "/previewx",
      "/preview/x",
      "/api/cron",
      "/api/cronjob/x",
      "/api/auth/sign-in/email",
      "/api/form-token",
      "/api/locations/suggest",
      "/sitemap.xml",
      "/homes/sitemap/0.xml",
      "/robots.txt.bak",
      "/dashboard",
      "/sign-in",
      "/alerts",
      "/alerts/one-click/x",
      "/alerts/unsubscribex",
      "/account/alerts",
    ]) {
      expect(isPreviewExemptPath(p), p).toBe(false);
    }
  });

  it("draws the pages it leaves open without the site's header, tab bar and footer while on", () => {
    // Every page a visitor without the password can open.
    for (const p of ["/preview", "/alerts/unsubscribe", "/alerts/one-click"]) {
      expect(isPreviewExemptPath(p) && isPageRequest("GET", p), p).toBe(true);
      expect(standsAlone(p, true), p).toBe(true);
    }
    // Gate off: only the coming-soon page (which then redirects home).
    expect(standsAlone("/preview", false)).toBe(true);
    expect(standsAlone("/alerts/unsubscribe", false)).toBe(false);
    for (const p of ["/", "/homes", "/contact", "/account/alerts", "/alerts", "/previewx"]) {
      expect(standsAlone(p, true), p).toBe(false);
      expect(standsAlone(p, false), p).toBe(false);
    }
  });

  it("the alert emails' pages leave out the site footer (and its sample towns) while gated", () => {
    const render = () =>
      AlertsLayout({ children: "page", params: Promise.resolve({}) } as LayoutProps<"/">);
    vi.stubEnv("PREVIEW_PASSWORD", "");
    expect(render().type).toBe(SiteMain);
    vi.stubEnv("PREVIEW_PASSWORD", PASSWORD);
    const types = elementTypes(render());
    expect(types).not.toContain(SiteMain);
    expect(types).not.toContain(SiteFooter);
    expect(types).toContain("main");
  });

  it("tells page loads (GET/HEAD) from the API, files and posts", () => {
    expect(isPageRequest("GET", "/")).toBe(true);
    expect(isPageRequest("HEAD", "/homes/1-main-st-a1b2c3d")).toBe(true);
    expect(isPageRequest("GET", "/dashboard/leads/export")).toBe(true);
    expect(isPageRequest("POST", "/")).toBe(false);
    expect(isPageRequest("GET", "/api/form-token")).toBe(false);
    expect(isPageRequest("GET", "/api")).toBe(false);
    expect(isPageRequest("GET", "/sitemap.xml")).toBe(false);
    expect(isPageRequest("GET", "/homes/sitemap/3.xml")).toBe(false);
  });

  it("counts a browser opening a link from an account email (/api/auth/…) as a page load", () => {
    const NAV = new Headers({ "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" });
    const FETCH = new Headers({ "sec-fetch-mode": "cors", accept: "*/*" });
    const reset = "/api/auth/reset-password/abc123";
    expect([isApiPath(reset), isApiPath("/api"), isApiPath("/apis"), isApiPath("/")]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(isPageRequest("GET", reset, NAV)).toBe(true);
    expect(isPageRequest("HEAD", "/api/auth/verify-email", NAV)).toBe(true);
    // Browsers without Sec-Fetch: an HTML Accept.
    expect(isPageRequest("GET", reset, new Headers({ accept: "text/html,*/*;q=0.8" }))).toBe(true);
    // Fetches from a page, posts and the rest of the API stay refused.
    expect(isPageRequest("GET", reset)).toBe(false);
    expect(isPageRequest("GET", reset, FETCH)).toBe(false);
    expect(isPageRequest("GET", "/api/auth/get-session", FETCH)).toBe(false);
    expect(
      isPageRequest("GET", reset, new Headers({ "sec-fetch-mode": "cors", accept: "text/html" })),
    ).toBe(false);
    expect(isPageRequest("POST", "/api/auth/sign-in/email", NAV)).toBe(false);
    expect(isPageRequest("GET", "/api/form-token", NAV)).toBe(false);
    expect(isPageRequest("GET", "/api/locations/suggest", NAV)).toBe(false);
  });

  it("the proxy runs on every page, route handler, RSC fetch and action, but not on Next's files or the public images", () => {
    const runs = (url: string, headers?: Record<string, string>) =>
      unstable_doesMiddlewareMatch({ config, url, headers });
    for (const url of [
      "/",
      "/about",
      "/homes?_rsc=abc12",
      "/homes/1-main-st-a1b2c3d",
      "/preview",
      "/sign-in",
      "/dashboard/leads",
      "/api/auth/sign-in/email",
      "/api/cron/sync",
      "/api/form-token",
      "/robots.txt",
      "/sitemap.xml",
      "/areas/sitemap.xml",
      "/alerts/one-click",
    ]) {
      expect(runs(url), url).toBe(true);
    }
    expect(runs("/", { rsc: "1", "next-router-prefetch": "1" })).toBe(true);
    expect(runs("/", { "next-action": "abc123" })).toBe(true);
    for (const url of [
      "/_next/static/chunks/main.js",
      "/_next/static/media/inter.woff2",
      "/_next/image?url=%2Fteam%2Fx.webp&w=640&q=75",
      "/favicon.ico",
      "/icon.svg",
      "/brand/gamls_idx.png",
      "/team/andrea-anderegg.webp",
      "/vendor/maplibre/maplibre-gl-csp-worker.js",
    ]) {
      expect(runs(url), url).toBe(false);
    }
  });
});

describe("where to go after unlocking", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/homes?q=Royston&mode=rent")).toBe("/homes?q=Royston&mode=rent");
    expect(previewNext("/homes/1-main-st-a1b2c3d#photos")).toBe("/homes/1-main-st-a1b2c3d#photos");
    expect(previewNext("/")).toBe("/");
  });

  it("refuses anything that leaves the site", () => {
    for (const bad of [
      "//evil.example",
      "//evil.example/homes",
      "/\\evil.example",
      "/\\/evil.example",
      "https://evil.example",
      "http:/evil.example",
      "javascript:alert(1)",
      "evil.example",
      " /homes",
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r\n//evil.example",
      "/homes\u0000",
      "",
      // Dot segments that a browser resolves to "//evil.example".
      "/.//evil.example",
      "/a/..//evil.example",
      "/%2e//evil.example",
      "/%2E%2E//evil.example",
      "/homes/../..//evil.example/phish",
      "/./\\evil.example",
      "/homes/..\\/evil.example",
    ]) {
      expect(previewNext(bad), JSON.stringify(bad)).toBe("/");
      expect(safeNext(bad), JSON.stringify(bad)).toBe("/");
    }
    expect(previewNext(undefined)).toBe("/");
    expect(previewNext(null)).toBe("/");
    expect(previewNext(new Blob(["/homes"]))).toBe("/");
    expect(safeNext(["/homes", "//evil.example"])).toBe("/homes");
    expect(safeNext(["//evil.example", "/homes"])).toBe("/");
  });

  it("returns the path as a browser resolves it", () => {
    expect(previewNext("/./homes")).toBe("/homes");
    expect(previewNext("/agents/../homes?q=Royston#map")).toBe("/homes?q=Royston#map");
    expect(previewNext("/homes?next=//evil.example")).toBe("/homes?next=//evil.example");
  });

  it("never goes back to the coming-soon page", () => {
    expect(previewNext("/preview")).toBe("/");
    expect(previewNext("/./preview")).toBe("/");
    expect(previewNext("/homes/../preview?next=%2Fhomes")).toBe("/");
    expect(previewNext("/preview?next=%2Fhomes")).toBe("/");
    expect(previewNext("/preview/")).toBe("/");
  });

  it("sends visitors to the coming-soon page with where they were going", () => {
    expect(previewUrl("/")).toBe("/preview");
    expect(previewUrl("/homes?q=Royston%20GA")).toBe("/preview?next=%2Fhomes%3Fq%3DRoyston%2520GA");
    expect(previewUrl("/api/auth/reset-password/abc?callbackURL=%2Freset-password")).toBe(
      "/preview?next=%2Fapi%2Fauth%2Freset-password%2Fabc%3FcallbackURL%3D%252Freset-password",
    );
    expect(previewUrl("//evil.example")).toBe("/preview");
  });
});

/** A request as the proxy sees it (Next has already stripped `rsc` and `_rsc` in production). */
function req(
  path: string,
  { method = "GET", headers = {} as Record<string, string>, cookie = "" } = {},
) {
  const h: Record<string, string> = { "user-agent": CHROME, ...headers };
  if (cookie) h.cookie = cookie;
  return new NextRequest(`http://localhost${path}`, { method, headers: h });
}

const unlocked = async (password = PASSWORD) =>
  `${PREVIEW_COOKIE}=${await previewToken(password, env.BETTER_AUTH_SECRET)}`;

const ACTION = { "next-action": "7f00aa", "content-type": "text/plain;charset=UTF-8" };

describe("the proxy with the gate on", () => {
  beforeEach(() => vi.stubEnv("PREVIEW_PASSWORD", PASSWORD));

  const expectGatedHeaders = (res: Response) => {
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  };

  it("sends a page load to the coming-soon page, remembering where it was going", async () => {
    const home = await proxy(req("/"));
    expect(home.status).toBe(307);
    expect(home.headers.get("location")).toBe("http://localhost/preview");
    expectGatedHeaders(home);

    const search = await proxy(req("/homes?q=Royston&mode=buy", { method: "HEAD" }));
    expect(search.status).toBe(307);
    expect(search.headers.get("location")).toBe(
      "http://localhost/preview?next=%2Fhomes%3Fq%3DRoyston%26mode%3Dbuy",
    );
    expectGatedHeaders(search);
  });

  it("redirects an RSC fetch the same way (the router replays it), without the _rsc parameter", async () => {
    const res = await proxy(
      req("/homes/1-main-st-a1b2c3d?_rsc=1a2b3", {
        headers: { rsc: "1", "next-url": "/homes", "sec-fetch-dest": "empty" },
      }),
    );
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/preview?next=%2Fhomes%2F1-main-st-a1b2c3d",
    );
    expectGatedHeaders(res);
  });

  it("refuses server actions, the API (sign-in included) and sitemaps with a bare 401", async () => {
    for (const [path, init] of [
      ["/", { method: "POST", headers: ACTION }],
      ["/homes/1-main-st-a1b2c3d", { method: "POST", headers: ACTION }],
      [
        "/api/auth/sign-in/email",
        { method: "POST", headers: { "content-type": "application/json" } },
      ],
      ["/api/auth/get-session", {}],
      ["/api/form-token", {}],
      ["/api/locations/suggest?q=roy", {}],
      ["/sitemap.xml", {}],
      ["/homes/sitemap/0.xml", {}],
    ] as const) {
      const res = await proxy(req(path, init));
      expect(res.status, path).toBe(401);
      expect(res.headers.get("location"), path).toBeNull();
      expect(await res.text(), path).toBe("Preview access required.");
      expectGatedHeaders(res);
    }
  });

  it("does no database work for a gated visitor, even on listing pages", async () => {
    const ip = { "x-forwarded-for": "203.0.113.9" };
    await proxy(req("/homes", { headers: ip }));
    await proxy(req("/api/locations/suggest?q=roy", { headers: ip }));
    expect(hitRateLimits).not.toHaveBeenCalled();
  });

  it("lets cron, robots.txt and the coming-soon page (and its unlock form) through", async () => {
    for (const [path, init] of [
      ["/api/cron/sync", { headers: { authorization: "Bearer x" } }],
      ["/api/cron/sync?purge=1", {}],
      ["/robots.txt", {}],
      ["/preview", {}],
      ["/preview?next=%2Fhomes", {}],
      ["/preview", { method: "POST", headers: ACTION }],
      // Alert emails' unsubscribe links: the mail provider's one-click post, and the
      // footer link's confirm page and its server action.
      [
        "/alerts/one-click?token=x",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
        },
      ],
      ["/alerts/unsubscribe?token=x", {}],
      ["/alerts/unsubscribe?token=x", { method: "POST", headers: ACTION }],
    ] as const) {
      const res = await proxy(req(path, init));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
      expectGatedHeaders(res);
    }
  });

  it("sends a link from an account email to the coming-soon page, but not a script's fetch of it", async () => {
    const link = "/api/auth/reset-password/abc123?callbackURL=%2Freset-password";
    const opened = await proxy(
      req(link, {
        headers: {
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
          accept: "text/html",
        },
      }),
    );
    expect(opened.status).toBe(307);
    expect(opened.headers.get("location")).toBe(
      "http://localhost/preview?next=%2Fapi%2Fauth%2Freset-password%2Fabc123%3FcallbackURL%3D%252Freset-password",
    );
    expectGatedHeaders(opened);
    const fetched = await proxy(req(link, { headers: { "sec-fetch-mode": "cors" } }));
    expect(fetched.status).toBe(401);
    expectGatedHeaders(fetched);
  });

  it("lets an unlocked browser in, still noindex and never cached", async () => {
    const cookie = await unlocked();
    for (const [path, init] of [
      ["/", {}],
      ["/about", {}],
      ["/", { method: "POST", headers: ACTION }],
      ["/api/auth/sign-in/email", { method: "POST" }],
      ["/sitemap.xml", {}],
    ] as const) {
      const res = await proxy(req(path, { ...init, cookie }));
      expect(res.status, path).toBe(200);
      expect(res.headers.get("x-middleware-next"), path).toBe("1");
      expectGatedHeaders(res);
    }
    // The other jobs still run behind the gate: account pages bounce to sign-in.
    const saved = await proxy(req("/saved", { cookie }));
    expect(saved.headers.get("location")).toBe("http://localhost/sign-in?next=%2Fsaved");
    expectGatedHeaders(saved);
  });

  it("locks out a browser whose cookie is tampered with, or from before the password changed", async () => {
    const stale = await unlocked("the-old-password");
    expect((await proxy(req("/", { cookie: stale }))).status).toBe(307);
    const good = await unlocked();
    const tampered = good.slice(0, -1) + (good.endsWith("0") ? "1" : "0");
    expect((await proxy(req("/", { cookie: tampered }))).status).toBe(307);
    expect(
      (await proxy(req("/", { method: "POST", headers: ACTION, cookie: tampered }))).status,
    ).toBe(401);
  });

  it("robots.txt disallows everything and lists no sitemaps", async () => {
    expect(await robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("the decision itself, for a request the proxy never sees mutated", async () => {
    const decide = (path: string, method = "GET") =>
      previewGate(
        { method, nextUrl: new URL(`http://x${path}`), cookies: { get: () => undefined } },
        PASSWORD,
        SECRET,
      );
    expect(await decide("/agents")).toEqual({
      action: "redirect",
      location: "/preview?next=%2Fagents",
    });
    expect(await decide("/agents", "DELETE")).toEqual({ action: "deny" });
    expect(await decide("/api/cron/alerts", "POST")).toEqual({ action: "pass" });
    expect(
      await previewGate(
        { method: "GET", nextUrl: new URL("http://x/"), cookies: { get: () => undefined } },
        null,
        SECRET,
      ),
    ).toEqual({ action: "off" });
  });
});

describe("the proxy with the gate off", () => {
  for (const value of [undefined, "", "  "]) {
    it(`works exactly as before (PREVIEW_PASSWORD=${JSON.stringify(value)})`, async () => {
      if (value !== undefined) vi.stubEnv("PREVIEW_PASSWORD", value);
      for (const [path, init] of [
        ["/", {}],
        ["/homes?_rsc=1a2b3", { headers: { rsc: "1" } }],
        ["/", { method: "POST", headers: ACTION }],
        ["/api/auth/sign-in/email", { method: "POST" }],
        ["/api/cron/sync", {}],
        ["/robots.txt", {}],
        ["/sitemap.xml", {}],
        ["/preview", {}],
      ] as const) {
        const res = await proxy(req(path, init));
        expect(res.status, path).toBe(200);
        expect(res.headers.get("x-middleware-next"), path).toBe("1");
        expect(res.headers.get("cache-control"), path).toBeNull();
        expect(res.headers.get("x-robots-tag"), path).toBeNull();
      }
      const saved = await proxy(req("/saved"));
      expect(saved.status).toBe(307);
      expect(saved.headers.get("location")).toBe("http://localhost/sign-in?next=%2Fsaved");
    });
  }

  it("counts listing traffic as before, and adds no database work anywhere else", async () => {
    const ip = { "x-forwarded-for": "203.0.113.9" };
    for (const path of ["/", "/about", "/contact", "/preview", "/areas/royston", "/agents/x"]) {
      await proxy(req(path, { headers: ip }));
    }
    await proxy(req("/", { method: "POST", headers: { ...ip, ...ACTION } }));
    await proxy(req("/api/auth/sign-in/email", { method: "POST", headers: ip }));
    expect(hitRateLimits).not.toHaveBeenCalled();
    await proxy(req("/homes", { headers: ip }));
    expect(hitRateLimits).toHaveBeenCalled();
  });

  it("robots.txt is the usual one", async () => {
    // "none": no listing count, so no database.
    vi.stubEnv("LISTINGS_INDEXING", "none");
    expect((await robots()).rules).not.toEqual({ userAgent: "*", disallow: "/" });
  });
});
