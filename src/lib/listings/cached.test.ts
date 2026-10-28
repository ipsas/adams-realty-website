import { beforeEach, describe, expect, it, vi } from "vitest";
import { areas } from "@/config/areas";
import { emptyStats } from "@/lib/areas/stats";

// cached.ts against a stand-in for Next's data cache that behaves like the
// real one: it stores each result as JSON and serves hits by JSON.parse.
const h = vi.hoisted(() => ({
  registrations: [] as Array<{ keyParts: string[]; options: unknown }>,
  calls: {} as Record<string, number>,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (
    fn: (...args: unknown[]) => Promise<unknown>,
    keyParts: string[],
    options: unknown,
  ) => {
    h.registrations.push({ keyParts, options });
    const store = new Map<string, string>();
    return async (...args: unknown[]) => {
      const key = JSON.stringify(args);
      const hit = store.get(key);
      if (hit !== undefined) return JSON.parse(hit);
      const result = await fn(...args);
      store.set(key, JSON.stringify(result));
      return result;
    };
  },
}));

const OPEN_HOUSE = new Date("2026-10-03T17:00:00Z");
const UPDATED = new Date("2026-09-24T15:30:00Z");
const count = (name: string) => {
  h.calls[name] = (h.calls[name] ?? 0) + 1;
};

vi.mock("./queries", () => ({
  getFeaturedListings: async (limit: number) => {
    count("featured");
    return Array.from({ length: limit }, (_, i) => ({
      id: `id-${i}`,
      slug: `home-${i}`,
      isNew: i === 1,
      nextOpenHouse: i === 0 ? OPEN_HOUSE : null,
      removedAt: null,
      photos: [],
    }));
  },
  getMarketStats: async () => {
    count("stats");
    return { active: 42, newThisWeek: 3, medianPrice: 350_000, openHouses: 2 };
  },
  getPopularAreas: async () => {
    count("popular");
    return [{ city: "Royston", count: 12, medianPrice: 250_000, photo: null }];
  },
  getTopCities: async () => {
    count("top");
    return [{ city: "Atlanta", count: 30 }];
  },
  getPlacesIndex: async () => {
    count("places");
    return [{ county: "Fulton", cities: [{ city: "Atlanta", count: 30 }] }];
  },
}));

vi.mock("@/lib/areas/queries", () => ({
  getAreaStats: async (list: Array<{ slug: string }>) => {
    count(list.length === 1 ? "guide" : "summaries");
    return new Map(
      list.map((a) => [a.slug, { ...emptyStats(), forSale: 5, lastUpdated: UPDATED }]),
    );
  },
}));

vi.stubEnv("NODE_ENV", "production");
const cached = await import("./cached");

beforeEach(() => {
  h.calls = {};
});

describe("cached listing queries", () => {
  it("register under the listings tag with the 15-minute backstop, each under its own key", () => {
    expect(h.registrations).toHaveLength(7);
    for (const r of h.registrations) {
      expect(r.options).toEqual({ tags: ["listings"], revalidate: 900 });
    }
    const keys = h.registrations.map((r) => r.keyParts.join());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("serve a second request from the cache, with Dates intact", async () => {
    const first = await cached.getCachedFeaturedListings(4);
    const second = await cached.getCachedFeaturedListings(4);
    expect(h.calls.featured).toBe(1);
    expect(second).toEqual(first);
    expect(second[0].nextOpenHouse).toBeInstanceOf(Date);
    expect(second[0].nextOpenHouse).toEqual(OPEN_HOUSE);
    expect(second[1].nextOpenHouse).toBeNull();
    // A different argument is a different entry.
    await cached.getCachedFeaturedListings(8);
    expect(h.calls.featured).toBe(2);
  });

  it("cache every home page and GA-A query", async () => {
    for (let i = 0; i < 2; i++) {
      await cached.getCachedMarketStats();
      await cached.getCachedPopularAreas(9);
      await cached.getCachedTopCities(12);
      await cached.getCachedPlacesIndex();
    }
    expect(h.calls).toEqual({ stats: 1, popular: 1, top: 1, places: 1 });
    expect(await cached.getCachedTopCities(12)).toEqual([{ city: "Atlanta", count: 30 }]);
  });

  it("area summaries: config order, one query, dates revived", async () => {
    await cached.getCachedAreaSummaries();
    const summaries = await cached.getCachedAreaSummaries();
    expect(h.calls.summaries).toBe(1);
    expect(summaries.map((s) => s.area.slug)).toEqual(areas.map((a) => a.slug));
    expect(summaries[0].stats.forSale).toBe(5);
    expect(summaries[0].stats.lastUpdated).toEqual(UPDATED);
  });

  it("area guides: stats cached per slug, unknown slugs null", async () => {
    const slug = areas[0].slug;
    await cached.getCachedAreaGuide(slug);
    const guide = await cached.getCachedAreaGuide(slug);
    expect(guide?.area.slug).toBe(slug);
    expect(guide?.stats.lastUpdated).toEqual(UPDATED);
    expect(await cached.getCachedAreaGuide("no-such-place")).toBeNull();
  });
});
