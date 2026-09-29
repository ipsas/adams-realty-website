import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "@/lib/local-store";
import { listingSlugOf, PLACE_MAX_AGE_MS, placeKey, readPlace, writePlace } from "./restore";

function mapStorage(): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

describe("placeKey", () => {
  it("ignores the sheet position and save=, keeps the View filter, and sorts params", () => {
    expect(placeKey("/homes?q=Royston&view=map")).toBe("ar:search:/homes?q=Royston");
    expect(placeKey("/homes?view=1&q=Royston&view=list&save=abc")).toBe(
      "ar:search:/homes?q=Royston&view=1",
    );
    expect(placeKey("/homes?beds=3&q=Royston")).toBe(placeKey("/homes?q=Royston&beds=3"));
    expect(placeKey("/homes")).toBe("ar:search:/homes");
  });

  it("tells different searches apart", () => {
    expect(placeKey("/homes?q=Royston")).not.toBe(placeKey("/homes?q=Hartwell"));
    expect(placeKey("/homes?q=Royston")).not.toBe(placeKey("/homes?q=Royston&page=2"));
  });
});

describe("readPlace / writePlace", () => {
  it("round-trips a place under the same search, whatever the sheet position", () => {
    const storage = mapStorage();
    writePlace(
      "/homes?q=Royston",
      { scrollTop: 1234.4, slug: "12-main-st-royston", view: "map" },
      { storage, now: 5_000 },
    );
    expect(readPlace("/homes?q=Royston&view=map", { storage, now: 6_000 })).toEqual({
      scrollTop: 1234,
      slug: "12-main-st-royston",
      view: "map",
      savedAt: 5_000,
    });
    expect(readPlace("/homes?q=Hartwell", { storage, now: 6_000 })).toBeNull();
  });

  it("forgets a place after 30 minutes", () => {
    const storage = mapStorage();
    writePlace("/homes", { scrollTop: 10, slug: null, view: "list" }, { storage, now: 0 });
    expect(readPlace("/homes", { storage, now: PLACE_MAX_AGE_MS })).not.toBeNull();
    expect(readPlace("/homes", { storage, now: PLACE_MAX_AGE_MS + 1 })).toBeNull();
  });

  it("sanitizes what it reads back (storage is user-editable)", () => {
    const storage = mapStorage();
    const key = placeKey("/homes");
    storage.setItem(key, JSON.stringify({ scrollTop: -5, slug: null, view: "list", savedAt: 1 }));
    expect(readPlace("/homes", { storage, now: 2 })).toBeNull();
    storage.setItem(
      key,
      JSON.stringify({ scrollTop: 50, slug: '"]<script>', view: "sideways", savedAt: 1 }),
    );
    expect(readPlace("/homes", { storage, now: 2 })).toEqual({
      scrollTop: 50,
      slug: null,
      view: "list",
      savedAt: 1,
    });
    storage.setItem(key, "not json");
    expect(readPlace("/homes", { storage, now: 2 })).toBeNull();
  });

  it("reads nothing when storage is unavailable", () => {
    expect(readPlace("/homes", { storage: null })).toBeNull();
    expect(() =>
      writePlace("/homes", { scrollTop: 1, slug: null, view: "list" }, { storage: null }),
    ).not.toThrow();
  });
});

describe("listingSlugOf", () => {
  it("finds the slug of a listing link and nothing else", () => {
    expect(listingSlugOf("/homes/12-main-st-royston-ga")).toBe("12-main-st-royston-ga");
    expect(listingSlugOf("/homes?q=Royston")).toBeNull();
    expect(listingSlugOf("/homes/a/b")).toBeNull();
    expect(listingSlugOf("https://evil.example/homes/x")).toBeNull();
    expect(listingSlugOf(null)).toBeNull();
  });
});
