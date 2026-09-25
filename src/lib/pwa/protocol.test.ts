import { describe, expect, it } from "vitest";
import {
  isCacheablePage,
  isNeverIntercepted,
  isStaticAsset,
  isSwMessage,
  NEVER,
  PAGE_ALLOW,
  type RequestLike,
} from "./protocol";

const ORIGIN = "https://adamsrealty.example";

function req(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    method: init.method ?? "GET",
    url: new URL(path, ORIGIN).href,
    headers: { get: (n: string) => headers.get(n.toLowerCase()) ?? null },
  } satisfies RequestLike;
}

describe("PAGE_ALLOW", () => {
  it.each([
    "/",
    "/homes",
    "/homes?q=Decatur&beds=3",
    "/homes/123-oak-st-decatur-ga-30030-a1b2c3d",
    "/saved",
    "/saved?tab=searches",
    "/agents",
    "/agents/daniel-adams",
  ])("caches %s", (path) => expect(isCacheablePage(path, ORIGIN)).toBe(true));

  it.each([
    "/dashboard",
    "/dashboard/leads/abc",
    "/account",
    "/account/settings",
    "/sign-in",
    "/sign-in?next=%2Fsaved",
    "/sign-up",
    "/forgot-password",
    "/reset-password?token=x",
    "/api/auth/get-session",
    "/api/locations/suggest?q=dec",
    "/alerts/unsubscribe?token=x",
    "/dev/primitives",
    "/sell",
    "/offline",
    "/homes/a/b",
    "/homes?_rsc=abc",
    "/homes/123-oak-st?_rsc=1",
    "https://evil.example/",
  ])("never caches %s", (path) => expect(isCacheablePage(path, ORIGIN)).toBe(false));

  it("never overlaps NEVER", () => {
    for (const path of ["/", "/homes", "/homes/x", "/saved", "/agents", "/agents/x"]) {
      expect(PAGE_ALLOW.some((re) => re.test(path))).toBe(true);
      expect(NEVER.some((re) => re.test(path))).toBe(false);
    }
  });
});

describe("isNeverIntercepted", () => {
  it("passes ordinary page, asset and photo GETs to the SW", () => {
    expect(isNeverIntercepted(req("/homes/abc"), ORIGIN)).toBe(false);
    expect(isNeverIntercepted(req("/_next/static/chunks/app.js"), ORIGIN)).toBe(false);
    expect(isNeverIntercepted(req("https://images.example/photo.jpg"), ORIGIN)).toBe(false);
  });

  it("skips non-GET requests, including server actions", () => {
    expect(isNeverIntercepted(req("/homes/abc", { method: "POST" }), ORIGIN)).toBe(true);
    expect(
      isNeverIntercepted(
        req("/saved", { method: "POST", headers: { "Next-Action": "abc" } }),
        ORIGIN,
      ),
    ).toBe(true);
  });

  it("skips RSC payloads, prefetches and Range requests", () => {
    expect(isNeverIntercepted(req("/saved", { headers: { RSC: "1" } }), ORIGIN)).toBe(true);
    expect(
      isNeverIntercepted(req("/homes", { headers: { "Next-Router-Prefetch": "1" } }), ORIGIN),
    ).toBe(true);
    expect(isNeverIntercepted(req("/homes?_rsc=1x2y"), ORIGIN)).toBe(true);
    expect(isNeverIntercepted(req("/video.mp4", { headers: { Range: "bytes=0-" } }), ORIGIN)).toBe(
      true,
    );
  });

  it.each([
    "/api/auth/sign-out",
    "/api/cron/sync",
    "/dashboard",
    "/account",
    "/sign-in",
    "/sign-up",
    "/reset-password",
    "/forgot-password",
    "/alerts/unsubscribe",
    "/dev/primitives",
  ])("skips private and auth path %s", (path) => {
    expect(isNeverIntercepted(req(path), ORIGIN)).toBe(true);
  });

  it("applies NEVER paths only to our own origin", () => {
    expect(isNeverIntercepted(req("https://tiles.example/api/tiles/1.png"), ORIGIN)).toBe(false);
  });
});

describe("isStaticAsset and isSwMessage", () => {
  it("recognizes hashed assets and the MapLibre worker", () => {
    expect(isStaticAsset("/_next/static/css/app.css", ORIGIN)).toBe(true);
    expect(isStaticAsset("/vendor/maplibre/6.11.2/worker.js", ORIGIN)).toBe(true);
    expect(isStaticAsset("/_next/image?url=x", ORIGIN)).toBe(false);
    expect(isStaticAsset("https://cdn.example/_next/static/x.js", ORIGIN)).toBe(false);
  });

  it("validates messages", () => {
    expect(isSwMessage({ type: "CLEAR_USER_DATA" })).toBe(true);
    expect(isSwMessage({ type: "CACHE_PAGES", urls: ["/homes/a"] })).toBe(true);
    expect(isSwMessage({ type: "CACHE_PAGES", urls: [1] })).toBe(false);
    expect(isSwMessage({ type: "NOPE" })).toBe(false);
    expect(isSwMessage(null)).toBe(false);
  });
});
