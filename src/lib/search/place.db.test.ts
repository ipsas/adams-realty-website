import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { findSearchMatches } from "@/lib/alerts/queries";
import { getLocationSuggestions } from "@/lib/listings/queries";
import { refreshPlaces } from "@/lib/listings/places";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { centerOf, nearbyTowns, placeBounds, resolveTown } from "./place";
import { searchListings, searchMapPins } from "./service";

// Site review #5 and #8 against Postgres: a town search is that town only, a lake
// search is the lake area, commercial stays out by default, no-results helpers find
// the place and its neighbours, and the land sorts order by acreage.

const crit = (qs: string) => parseSearchParams(new URLSearchParams(qs));
const ACRE = 43_560;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  const hart = { county: "Hart", state: "GA" };
  await insertListings(source, [
    // Hartwell, the town: three homes, one on the lake.
    listing(1, { ...hart, city: "Hartwell", latitude: 34.35, longitude: -82.93 }),
    listing(2, { ...hart, city: "Hartwell", latitude: 34.36, longitude: -82.92 }),
    listing(3, {
      ...hart,
      city: "Hartwell",
      neighborhood: "Cedar Cove",
      waterBodyName: "Lake Hartwell",
      latitude: 34.37,
      longitude: -82.95,
    }),
    // "Lake Hartwell" homes whose mail goes to other towns.
    listing(4, {
      city: "Lavonia",
      county: "Franklin",
      neighborhood: "Lake Hartwell",
      latitude: 34.43,
      longitude: -83.1,
    }),
    listing(5, {
      city: "Toccoa",
      county: "Stephens",
      neighborhood: "Lake Hartwell",
      latitude: 34.55,
      longitude: -83.3,
    }),
    // Land around Royston: 10, 50 and 166 acres, and a lot with no size.
    listing(6, {
      city: "Royston",
      county: "Franklin",
      propertyType: "land",
      listPrice: 150_000,
      lotSizeSqft: 10 * ACRE,
      latitude: 34.28,
      longitude: -83.11,
    }),
    listing(7, {
      city: "Royston",
      county: "Franklin",
      propertyType: "land",
      listPrice: 250_000,
      lotSizeSqft: 50 * ACRE,
      latitude: 34.29,
      longitude: -83.1,
    }),
    listing(8, {
      city: "Carnesville",
      county: "Franklin",
      propertyType: "land",
      listPrice: 1_000_000,
      lotSizeSqft: 166 * ACRE,
      latitude: 34.37,
      longitude: -83.23,
    }),
    listing(9, {
      city: "Royston",
      county: "Franklin",
      propertyType: "land",
      listPrice: 40_000,
      lotSizeSqft: null,
      latitude: 34.28,
      longitude: -83.12,
    }),
    // A storefront in Royston: only a commercial search shows it.
    listing(10, {
      city: "Royston",
      county: "Franklin",
      propertyType: "commercial",
      latitude: 34.287,
      longitude: -83.11,
    }),
    // Bowman: every home there has sold.
    listing(11, {
      city: "Bowman",
      county: "Elbert",
      status: "closed",
      closeDate: daysAgo(40),
      closePrice: 180_000,
      latitude: 34.2,
      longitude: -82.98,
    }),
  ]);
  await refreshPlaces(db);
});
afterAll(closeDb);

const cities = async (qs: string) =>
  (await searchListings(crit(qs))).items.map((l) => l.city).sort();

describe("a town search is that town only", () => {
  it("resolves a town as the listings spell it, and nothing else", async () => {
    expect(await resolveTown(db, "hartwell, ga")).toBe("Hartwell");
    expect(await resolveTown(db, "Bowman")).toBe("Bowman");
    expect(await resolveTown(db, "Lake Hartwell")).toBeUndefined();
    expect(await resolveTown(db, "Cedar Cove")).toBeUndefined();
    expect(await resolveTown(db, "30662")).toBeUndefined();
    expect(await resolveTown(db, "Nowhereville")).toBeUndefined();
  });

  it("'Hartwell' lists Hartwell's homes, not the lake's homes in Lavonia and Toccoa", async () => {
    expect(await cities("q=Hartwell")).toEqual(["Hartwell", "Hartwell", "Hartwell"]);
    const pins = await searchMapPins(crit("q=Hartwell"));
    expect(pins.map((p) => p.address).every((a) => a.endsWith("Hartwell"))).toBe(true);
  });

  it("'Lake Hartwell' is the lake area, whatever the town", async () => {
    expect(await cities("q=Lake Hartwell")).toEqual(["Hartwell", "Lavonia", "Toccoa"]);
  });

  it("a saved town search alerts on the town only", async () => {
    const now = new Date();
    const win = { start: new Date(0), end: now };
    const m = await findSearchMatches(db, crit("q=Hartwell"), { listings: win, events: win }, now);
    expect(m.newRows.map((r) => r.city)).toEqual(["Hartwell", "Hartwell", "Hartwell"]);
  });
});

describe("commercial is out of the default search (land stays in)", () => {
  it("leaves the storefront out unless commercial is picked", async () => {
    const all = await searchListings(crit("q=Royston"));
    expect(all.items.map((l) => l.propertyType).sort()).toEqual(["land", "land", "land"]);
    const shops = await searchListings(crit("q=Royston&types=commercial"));
    expect(shops.items.map((l) => l.propertyType)).toEqual(["commercial"]);
  });
});

describe("land sorts (site review #8)", () => {
  it("'Acreage (most first)' puts the biggest tract first, unknown sizes last", async () => {
    const r = await searchListings(crit("types=land&sort=lot_desc"));
    expect(r.items.map((l) => l.lotSizeSqft)).toEqual([166 * ACRE, 50 * ACRE, 10 * ACRE, null]);
  });

  it("'Price per acre' puts the cheapest acre first", async () => {
    const r = await searchListings(crit("types=land&sort=price_per_acre_asc"));
    // $6,024, $5,000 and $15,000 an acre: 50 acres first, then 166, then 10.
    expect(r.items.map((l) => l.listPrice)).toEqual([250_000, 1_000_000, 150_000, 40_000]);
  });

  it("map pins carry what the preview needs for land", async () => {
    const pins = await searchMapPins(crit("types=land&sort=lot_desc"));
    expect(pins[0]).toMatchObject({ propertyType: "land", lotSqft: 166 * ACRE, rent: false });
  });
});

describe("no results: where the place is and what's nearby", () => {
  it("finds a town from its past sales, and nearby towns with homes", async () => {
    expect((await searchListings(crit("q=Bowman"))).total).toBe(0);
    const bounds = await placeBounds(db, "Bowman", { town: "Bowman" });
    expect(bounds).not.toBeNull();
    expect(bounds!.south).toBeLessThan(34.2);
    expect(bounds!.north).toBeGreaterThan(34.2);
    const near = await nearbyTowns(db, crit("q=Bowman"), centerOf(bounds!), "Bowman");
    expect(near.length).toBeGreaterThanOrEqual(2);
    expect(near.length).toBeLessThanOrEqual(3);
    expect(near.map((t) => t.city)).not.toContain("Bowman");
    // Nearest first: Royston (about 10 miles), then Hartwell (about 12).
    expect(near.map((t) => t.city).slice(0, 2)).toEqual(["Royston", "Hartwell"]);
    expect(near.every((t) => t.filtered && t.count > 0)).toBe(true);
  });

  it("keeps the search's filters when a nearby town matches them, else drops them", async () => {
    const land = await nearbyTowns(
      db,
      crit("q=Bowman&types=land"),
      { lat: 34.2, lng: -82.98 },
      "Bowman",
    );
    expect(land.map((t) => t.city)).toEqual(["Royston", "Carnesville"]);
    expect(land.every((t) => t.filtered)).toBe(true);
    const none = await nearbyTowns(
      db,
      crit("q=Bowman&minPrice=900000000"),
      { lat: 34.2, lng: -82.98 },
      "Bowman",
    );
    expect(none.length).toBeGreaterThan(0);
    expect(none.every((t) => !t.filtered)).toBe(true);
  });

  it("knows nothing about a place with no listings", async () => {
    expect(await placeBounds(db, "Nowhereville")).toBeNull();
  });
});

describe("location suggestions", () => {
  it("offer the lake once, as a lake area", async () => {
    const out = await getLocationSuggestions("Lake Hart");
    expect(out.filter((s) => s.label.startsWith("Lake Hartwell"))).toEqual([
      expect.objectContaining({ kind: "lake", label: "Lake Hartwell (lake area)", count: 2 }),
    ]);
  });

  it("offer the town and the lake for 'Hartwell'", async () => {
    const out = await getLocationSuggestions("Hartwell");
    expect(out.map((s) => [s.kind, s.value])).toEqual([
      ["city", "Hartwell"],
      ["lake", "Lake Hartwell"],
    ]);
  });

  it("offer a town whose homes have all sold", async () => {
    const out = await getLocationSuggestions("Bow");
    expect(out).toEqual([
      expect.objectContaining({
        kind: "city",
        value: "Bowman",
        sublabel: "No homes listed right now",
      }),
    ]);
  });
});
