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

  it("robots.txt lists every sitemap, including each listing chunk", () => {
    const { sitemap } = robots();
    const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
    expect(sitemap).toEqual([
      `${base}/sitemap.xml`,
      `${base}/areas/sitemap.xml`,
      ...Array.from({ length: 12 }, (_, id) => `${base}/homes/sitemap/${id}.xml`),
    ]);
  });

  it("every sitemap renders per request, never at build", () => {
    for (const m of [homes, root, areas]) expect(m.dynamic).toBe("force-dynamic");
  });

  it("a chunk id outside the fixed set is an empty sitemap, not a query", async () => {
    await expect(homes.default({ id: Promise.resolve("12") })).resolves.toEqual([]);
    await expect(homes.default({ id: Promise.resolve("x") })).resolves.toEqual([]);
  });
});

describe("demo-data mode keeps crawlers off the sample data (src/lib/demo-mode.ts)", () => {
  afterEach(() => vi.unstubAllEnvs());
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  it("robots.txt disallows listings, search, guides, places and agents, and lists only the main sitemap", () => {
    vi.stubEnv("SEED_DEMO_DATA", "1");
    const r = robots();
    const rules = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rules.disallow).toEqual(
      expect.arrayContaining(["/homes", "/areas", "/places", "/agents", "/dashboard", "/api/"]),
    );
    expect(r.sitemap).toEqual([`${base}/sitemap.xml`]);
    // Launch day: switched off, everything is listed again.
    vi.stubEnv("DEMO_DATA_MODE", "off");
    const live = robots();
    const liveRules = Array.isArray(live.rules) ? live.rules[0] : live.rules;
    expect(liveRules.disallow).not.toContain("/homes");
    expect(live.sitemap).toHaveLength(14);
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
