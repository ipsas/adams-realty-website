import { beforeEach, describe, expect, it } from "vitest";
import { type KeyValueStorage, STORE_KEYS } from "@/lib/local-store";
import { parseSearchParams } from "./params";
import {
  clearRecents,
  LAST_SEARCH_COOKIE,
  lastSearchCookie,
  lastSearchHref,
  MAX_RECENT_SEARCHES,
  MAX_RECENTLY_VIEWED,
  readRecentSearches,
  readRecentlyViewed,
  recordSearch,
  recordView,
  type RecentDeps,
  setLastSearchView,
  type ViewedSnapshot,
} from "./recent";

function mapStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

let storage: ReturnType<typeof mapStorage>;
let cookies: string[];
let clock: number;
let deps: RecentDeps;

beforeEach(() => {
  storage = mapStorage();
  cookies = [];
  clock = 1_000;
  deps = { storage, setCookie: (c) => cookies.push(c), now: () => clock++ };
});

const search = (qs: string) => parseSearchParams(new URLSearchParams(qs));

describe("recordSearch", () => {
  it("stores the search, the last search and the relaunch cookie", () => {
    recordSearch(search("q=Decatur&beds=3"), undefined, deps);
    expect(readRecentSearches(deps)).toEqual([
      { href: "/homes?q=Decatur&beds=3", label: "3+ bd homes in Decatur", at: 1_000 },
    ]);
    expect(lastSearchHref(deps)).toBe("/homes?q=Decatur&beds=3");
    expect(cookies.at(-1)).toBe(
      `${LAST_SEARCH_COOKIE}=${encodeURIComponent("q=Decatur&beds=3")}; Path=/; Max-Age=7776000; SameSite=Lax`,
    );
  });

  it("includes the view in the last search but not in recents", () => {
    recordSearch(search("q=Decatur&page=2"), "list", deps);
    expect(readRecentSearches(deps)[0].href).toBe("/homes?q=Decatur");
    expect(lastSearchHref(deps)).toBe("/homes?q=Decatur&page=2&view=list");
    expect(decodeURIComponent(cookies.at(-1)!.split(";")[0].split("=").slice(1).join("="))).toBe(
      "q=Decatur&page=2&view=list",
    );
  });

  it("keeps the View amenity filter (view=1) in the last search, cookie and recents", () => {
    recordSearch(search("q=Hartwell&view=1"), "list", deps);
    expect(readRecentSearches(deps)[0].href).toBe("/homes?q=Hartwell&view=1");
    expect(lastSearchHref(deps)).toBe("/homes?q=Hartwell&view=1&view=list");
    expect(cookies.at(-1)).toContain(`=${encodeURIComponent("q=Hartwell&view=1&view=list")};`);

    setLastSearchView(null, deps);
    expect(lastSearchHref(deps)).toBe("/homes?q=Hartwell&view=1");
    recordSearch(search("q=Hartwell&view=1"), null, deps);
    expect(lastSearchHref(deps)).toBe("/homes?q=Hartwell&view=1");
  });

  it("treats the View amenity filter as a different search, not a sheet position", () => {
    recordSearch(search("q=Hartwell&view=1"), null, deps);
    recordSearch(search("q=Hartwell"), "map", deps);
    expect(readRecentSearches(deps).map((e) => e.href)).toEqual([
      "/homes?q=Hartwell",
      "/homes?q=Hartwell&view=1",
    ]);
  });

  it("dedupes by href, newest first, capped at 8", () => {
    for (let i = 0; i < 10; i++) recordSearch(search(`q=Area${i}`), null, deps);
    recordSearch(search("q=Area5"), null, deps);
    const list = readRecentSearches(deps);
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0].href).toBe("/homes?q=Area5");
    expect(list.filter((e) => e.href === "/homes?q=Area5")).toHaveLength(1);
  });

  it("keeps one entry per place and filters as the map moves or the sort changes", () => {
    recordSearch(search("q=Decatur"), null, deps);
    recordSearch(search("q=Midtown"), null, deps);
    recordSearch(search("q=Decatur&bounds=-84.4,33.7,-84.2,33.8"), null, deps);
    recordSearch(search("q=Decatur&bounds=-84.4,33.7,-84.2,33.8&sort=newest"), null, deps);
    expect(readRecentSearches(deps).map((e) => e.href)).toEqual([
      "/homes?q=Decatur&bounds=-84.4%2C33.7%2C-84.2%2C33.8&sort=newest",
      "/homes?q=Midtown",
    ]);
  });

  it("skips the default search in recents and deletes the cookie", () => {
    recordSearch(search(""), null, deps);
    expect(readRecentSearches(deps)).toEqual([]);
    expect(lastSearchHref(deps)).toBe("/homes");
    expect(cookies.at(-1)).toBe(`${LAST_SEARCH_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`);
  });
});

describe("setLastSearchView", () => {
  it("updates the stored href and the cookie", () => {
    recordSearch(search("q=Decatur"), null, deps);
    setLastSearchView("map", deps);
    expect(lastSearchHref(deps)).toBe("/homes?q=Decatur&view=map");
    expect(cookies.at(-1)).toContain(encodeURIComponent("q=Decatur&view=map"));
    setLastSearchView(null, deps);
    expect(lastSearchHref(deps)).toBe("/homes?q=Decatur");
  });

  it("does nothing before any search", () => {
    setLastSearchView("map", deps);
    expect(lastSearchHref(deps)).toBeNull();
    expect(cookies).toEqual([]);
  });
});

describe("lastSearchCookie", () => {
  it("deletes instead of writing an oversized value", () => {
    expect(lastSearchCookie(`q=${"x".repeat(1_600)}`)).toContain("Max-Age=0");
    expect(lastSearchCookie(`q=${"x".repeat(1_000)}`)).toContain("Max-Age=7776000");
  });
});

describe("sanitizing", () => {
  it("ignores tampered or malformed storage", () => {
    storage.setItem(STORE_KEYS.lastSearch, JSON.stringify({ href: "//evil.com/homes", at: 1 }));
    expect(lastSearchHref(deps)).toBeNull();
    storage.setItem(STORE_KEYS.lastSearch, JSON.stringify({ href: "javascript:alert(1)", at: 1 }));
    expect(lastSearchHref(deps)).toBeNull();
    storage.setItem(STORE_KEYS.lastSearch, "{not json");
    expect(lastSearchHref(deps)).toBeNull();
    storage.setItem(
      STORE_KEYS.recentSearches,
      JSON.stringify([
        { href: "https://evil.com", label: "x", at: 1 },
        { href: "/homes?q=Ok", label: "Homes in Ok", at: 2 },
        null,
        "nope",
      ]),
    );
    expect(readRecentSearches(deps)).toEqual([
      { href: "/homes?q=Ok", label: "Homes in Ok", at: 2 },
    ]);
  });

  it("tolerates storage that throws", () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    const d = { ...deps, storage: broken };
    expect(() => recordSearch(search("q=Decatur"), null, d)).not.toThrow();
    expect(readRecentSearches(d)).toEqual([]);
    expect(() => clearRecents(d)).not.toThrow();
  });
});

const home = (slug: string, extra: Partial<ViewedSnapshot> = {}): ViewedSnapshot => ({
  slug,
  address: "123 Oak St",
  cityLine: "Decatur, GA 30030",
  price: 450_000,
  photo: "https://img.example/1.jpg",
  beds: 3,
  baths: 2.5,
  listOfficeName: "Adams Realty",
  transactionType: "sale",
  status: "active",
  ...extra,
});

describe("recordView", () => {
  it("adds viewedAt, dedupes by slug and caps at 20", () => {
    for (let i = 0; i < 25; i++) recordView(home(`home-${i}`), deps);
    recordView(home("home-10", { price: 440_000 }), deps);
    const list = readRecentlyViewed(deps);
    expect(list).toHaveLength(MAX_RECENTLY_VIEWED);
    expect(list[0]).toMatchObject({
      slug: "home-10",
      price: 440_000,
      listOfficeName: "Adams Realty",
    });
    expect(list[0].viewedAt).toBeGreaterThan(list[1].viewedAt);
    expect(list.filter((e) => e.slug === "home-10")).toHaveLength(1);
  });

  it("drops unusable photos and rejects bad slugs", () => {
    recordView(home("ok-1", { photo: "javascript:alert(1)" }), deps);
    recordView(home("../../etc"), deps);
    expect(readRecentlyViewed(deps).map((e) => [e.slug, e.photo])).toEqual([["ok-1", null]]);
  });
});

describe("clearRecents", () => {
  it("removes searches, the last search, viewed homes and the cookie", () => {
    recordSearch(search("q=Decatur"), "map", deps);
    recordView(home("a"), deps);
    storage.setItem(STORE_KEYS.searchAsMove, "true");
    storage.setItem(STORE_KEYS.theme, '"light"');
    clearRecents(deps);
    expect(readRecentSearches(deps)).toEqual([]);
    expect(lastSearchHref(deps)).toBeNull();
    expect(readRecentlyViewed(deps)).toEqual([]);
    expect(cookies.at(-1)).toContain("Max-Age=0");
    // Preferences are not recents.
    expect(storage.getItem(STORE_KEYS.searchAsMove)).toBe("true");
    expect(storage.getItem(STORE_KEYS.theme)).toBe('"light"');
  });
});
