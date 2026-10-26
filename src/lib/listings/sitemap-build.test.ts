import { afterEach, describe, expect, it, vi } from "vitest";

// `next build` loads robots.ts and every sitemap module and calls
// generateSitemaps. None of that may need a database: make any import of the
// database client (or the pg driver) throw, then load them all.
vi.mock("@/db", () => {
  throw new Error("the database client was imported");
});
vi.mock("pg", () => {
  throw new Error("the pg driver was imported");
});

// (This test lives outside src/app so Next never mistakes it for a route file.)
const robots = (await import("@/app/robots")).default;
const homes = await import("@/app/homes/sitemap");
const root = await import("@/app/sitemap");
const areas = await import("@/app/(site)/areas/sitemap");

describe("sitemaps and robots load without a database", () => {
  it("generateSitemaps returns a fixed set of listing chunks", async () => {
    expect(await homes.generateSitemaps()).toEqual(Array.from({ length: 12 }, (_, id) => ({ id })));
  });

  it("robots.txt still loads without a database, listing no listing chunk (never all of them)", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { sitemap } = await robots();
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    expect(sitemap).toEqual([`${base}/sitemap.xml`, `${base}/areas/sitemap.xml`]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("every sitemap renders per request, never at build", () => {
    for (const m of [homes, root, areas]) expect(m.dynamic).toBe("force-dynamic");
  });

  it("a chunk id outside the fixed set is an empty sitemap, not a query", async () => {
    await expect(homes.default({ id: Promise.resolve("12") })).resolves.toEqual([]);
    await expect(homes.default({ id: Promise.resolve("x") })).resolves.toEqual([]);
  });
});

describe("LISTINGS_INDEXING=none offers crawlers no listings (src/lib/listings/indexing.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("every listing chunk is empty, without touching the database", async () => {
    vi.stubEnv("DEMO_DATA_MODE", "off");
    vi.stubEnv("LISTINGS_INDEXING", "none");
    await expect(homes.default({ id: Promise.resolve("0") })).resolves.toEqual([]);
  });
});

describe("demo-data mode keeps crawlers off the sample data (src/lib/demo-mode.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  it("robots.txt disallows listings, search, guides, places and agents, and lists only the main sitemap", async () => {
    vi.stubEnv("SEED_DEMO_DATA", "1");
    const r = await robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.disallow).toEqual(
      expect.arrayContaining(["/homes", "/areas", "/places", "/agents", "/dashboard", "/api/"]),
    );
    expect(r.sitemap).toEqual([`${base}/sitemap.xml`]);
    // Launch day: switched off, everything is listed again (no listing chunks here:
    // "none" mode skips the count, which would need the database).
    vi.stubEnv("DEMO_DATA_MODE", "off");
    vi.stubEnv("LISTINGS_INDEXING", "none");
    const live = await robots();
    const liveRules = Array.isArray(live.rules) ? live.rules[0] : live.rules;
    expect(liveRules.disallow).not.toContain("/homes");
    expect(live.sitemap).toEqual([`${base}/sitemap.xml`, `${base}/areas/sitemap.xml`]);
  });

  it("the sitemaps leave the sample pages out, without touching the database", async () => {
    vi.stubEnv("DEMO_DATA_MODE", "on");
    // Each of these would query (and so throw here) if demo mode didn't stop it first.
    await expect(homes.default({ id: Promise.resolve("0") })).resolves.toEqual([]);
    await expect(areas.default()).resolves.toEqual([]);
    const paths = (await root.default()).map((e) => new URL(e.url).pathname);
    expect(paths).toContain("/");
    expect(paths).toContain("/contact");
    for (const p of paths) {
      expect(p, p).not.toMatch(/^\/(homes|areas|places|agents)(\/|$)/);
    }
  });
});
