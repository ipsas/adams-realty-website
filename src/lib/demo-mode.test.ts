import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { demoDataMode, isDemoContentPath } from "./demo-mode";

// The listing-page lookup: every listing shown, no database.
vi.mock("./listings/missing-listing-db", () => ({ missingListingGuide: vi.fn(async () => null) }));

afterEach(() => vi.unstubAllEnvs());

const CHROME = { "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0 Safari/537.36" };

describe("demo-data mode", () => {
  it("is on exactly when the build loads sample data, unless DEMO_DATA_MODE says otherwise", () => {
    expect(demoDataMode({})).toBe(false);
    expect(demoDataMode({ SEED_DEMO_DATA: "1" })).toBe(true);
    expect(demoDataMode({ SEED_DEMO_DATA: "0" })).toBe(false);
    expect(demoDataMode({ SEED_DEMO_DATA: "1", DEMO_DATA_MODE: "off" })).toBe(false);
    expect(demoDataMode({ SEED_DEMO_DATA: "1", DEMO_DATA_MODE: "0" })).toBe(false);
    expect(demoDataMode({ DEMO_DATA_MODE: "on" })).toBe(true);
    expect(demoDataMode({ DEMO_DATA_MODE: " TRUE " })).toBe(true);
    // Anything else falls back to SEED_DEMO_DATA.
    expect(demoDataMode({ SEED_DEMO_DATA: "1", DEMO_DATA_MODE: "maybe" })).toBe(true);
  });

  it("covers search and listings, area guides, places and agents, and nothing else", () => {
    for (const p of [
      "/homes",
      "/homes/1-main-st",
      "/areas",
      "/areas/royston",
      "/places",
      "/agents",
      "/agents/andrea-anderegg",
    ]) {
      expect(isDemoContentPath(p), p).toBe(true);
    }
    for (const p of ["/", "/about", "/sell", "/contact", "/homesick", "/agentsx", "/dashboard"]) {
      expect(isDemoContentPath(p), p).toBe(false);
    }
  });

  it("the proxy sends noindex on those pages while it's on, and never on the firm's own pages", async () => {
    // No client IP in these requests, so the listing limiter counts nothing (no database).
    const tag = async (path: string) =>
      (await proxy(new NextRequest(`http://localhost${path}`, { headers: CHROME }))).headers.get(
        "x-robots-tag",
      );
    vi.stubEnv("DEMO_DATA_MODE", "on");
    for (const p of ["/homes", "/homes/1-main-st", "/areas/royston", "/places", "/agents/x"]) {
      expect(await tag(p), p).toBe("noindex, nofollow");
    }
    vi.stubEnv("DEMO_DATA_MODE", "off");
    for (const p of ["/homes", "/areas/royston", "/agents/x"]) {
      expect(await tag(p), p).toBeNull();
    }
  });

  it("the proxy still bounces signed-out visitors from account pages, and only those", async () => {
    const res = await proxy(new NextRequest("http://localhost/saved?x=1"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost/sign-in?next=%2Fsaved%3Fx%3D1");
    const open = await proxy(new NextRequest("http://localhost/areas/royston"));
    expect(open.headers.get("location")).toBeNull();
    expect(open.status).toBe(200);
  });
});
