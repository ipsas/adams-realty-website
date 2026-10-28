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

/** What notFound() throws: Next's route wrapper turns it into an HTTP 404. */
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

// (This test lives outside src/app so Next never mistakes it for a route file.)
const { areas: areaConfig } = await import("@/config/areas");
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

  it("a chunk id outside the fixed set is a 404, not a query", async () => {
    await expect(homes.default({ id: Promise.resolve("12") })).rejects.toMatchObject(NOT_FOUND);
    await expect(homes.default({ id: Promise.resolve("x") })).rejects.toMatchObject(NOT_FOUND);
  });
});

describe("/areas/sitemap.xml dates guides by their copy, not by listings", () => {
  afterEach(() => vi.unstubAllEnvs());
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  it("uses each area's `updated` as lastmod, and the latest for /areas", async () => {
    vi.stubEnv("DEMO_DATA_MODE", "off");
    const entries = await areas.default();
    const byPath = new Map(entries.map((e) => [new URL(e.url).pathname, e]));
    const latest = [...areaConfig]
      .map((a) => a.updated)
      .sort()
      .at(-1);
    expect(byPath.get("/areas")).toMatchObject({ lastModified: latest });
    expect(entries).toHaveLength(areaConfig.length + 1);
    for (const a of areaConfig) {
      expect(byPath.get(`/areas/${a.slug}`), a.slug).toEqual({
        url: `${base}/areas/${a.slug}`,
        lastModified: a.updated,
        changeFrequency: "daily",
        priority: 0.7,
      });
    }
  });
});

describe("LISTINGS_INDEXING=none offers crawlers no listings (src/lib/listings/indexing.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("every listing chunk is a 404, without touching the database", async () => {
    vi.stubEnv("DEMO_DATA_MODE", "off");
    vi.stubEnv("LISTINGS_INDEXING", "none");
    await expect(homes.default({ id: Promise.resolve("0") })).rejects.toMatchObject(NOT_FOUND);
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
    await expect(homes.default({ id: Promise.resolve("0") })).rejects.toMatchObject(NOT_FOUND);
    await expect(areas.default()).resolves.toEqual([]);
    const paths = (await root.default()).map((e) => new URL(e.url).pathname);
    expect(paths).toContain("/");
    expect(paths).toContain("/contact");
    for (const p of paths) {
      expect(p, p).not.toMatch(/^\/(homes|areas|places|agents)(\/|$)/);
    }
  });
});
