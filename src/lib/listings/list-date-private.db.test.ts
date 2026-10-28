import { inArray } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GET as suggestRoute } from "@/app/api/locations/suggest/route";
import { findArea } from "@/config/areas";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { alertListingColumns } from "@/lib/alerts/queries";
import { getAreaFeaturedListing, getAreaListings, getAreaStats } from "@/lib/areas/queries";
import { addDays, marketToday } from "@/lib/areas/stats";
import { isNewListing } from "@/lib/format";
import { parseSearchParams } from "@/lib/search/params";
import { locationPins, searchListings, searchMapPins } from "@/lib/search/service";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { cardColumns, selectCards, withPhotos } from "./card";
import {
  getFeaturedListings,
  getListingBySlug,
  getLocationSuggestions,
  getMarketStats,
  getNewestListings,
  getSimilarListings,
} from "./queries";

// An MLS listing's list date is derived from DaysOnMarket (mapper v5), so it is the
// OnMarketDate Georgia MLS Exhibit C keeps off the site: it may filter, sort and count in
// SQL, but no payload a visitor or crawler gets may carry it. Cards carry `isNew`, the
// property page `daysOnMarket`.

const today = marketToday();
// Three days on market: "New", and a date no other field of these rows holds.
const listDate = addDays(today, -3);
const boundary = {
  seven: addDays(today, -7),
  eight: addDays(today, -8),
  future: addDays(today, 2),
};
const allDates = [listDate, ...Object.values(boundary)];

const ids = new Map<string, string>();
let slug: string;
// A staff-entered listing: its list date isn't MLS data, and its history keeps its dates.
const manualListDate = "2026-01-15";
let manualSlug: string;

const royston = { city: "Royston", county: "Franklin", postalCode: "30662" };

beforeAll(async () => {
  await resetDb();
  const mls = await createSource();
  const now = new Date();
  const rows = [
    // Its "listed" event is dated by the sync, not the list date; the page gets no event dates.
    [
      "main",
      listing(1, {
        ...royston,
        listDate,
        sourceModifiedAt: now,
        latitude: 34.287,
        longitude: -83.11,
        media: [
          {
            sourceKey: "p1",
            url: "https://img.example.com/1.jpg",
            kind: "photo",
            caption: null,
            width: null,
            height: null,
            sortOrder: 0,
          },
        ],
      }),
    ],
    ["seven", listing(2, { ...royston, listDate: boundary.seven, sourceModifiedAt: now })],
    ["eight", listing(3, { ...royston, listDate: boundary.eight, sourceModifiedAt: now })],
    ["future", listing(4, { ...royston, listDate: boundary.future, sourceModifiedAt: now })],
    ["none", listing(5, { ...royston, listDate: null, sourceModifiedAt: now })],
  ] as const;
  const inserted = await insertListings(
    mls,
    rows.map(([, l]) => l),
  );
  rows.forEach(([key], i) => ids.set(key, inserted[i]));
  [{ slug }] = await db
    .select({ slug: listings.slug })
    .from(listings)
    .where(inArray(listings.id, [ids.get("main")!]));
  const adams = await createSource({ slug: "adams", kind: "manual", config: {} });
  const [manualId] = await insertListings(adams, [listing(6, { listDate: manualListDate })]);
  [{ slug: manualSlug }] = await db
    .select({ slug: listings.slug })
    .from(listings)
    .where(inArray(listings.id, [manualId]));
});
afterAll(closeDb);

/** No list date in `payload` as JSON: not the key, not the column, not the date itself. */
function expectNoListDate(payload: unknown, label: string) {
  const json = JSON.stringify(payload);
  for (const needle of ["listDate", "list_date", ...allDates]) {
    expect(json, `${label} holds ${needle}`).not.toContain(needle);
  }
}

describe("the property page's data", () => {
  it("carries days on market, never the list date", async () => {
    const detail = await getListingBySlug(slug);
    expect(detail).not.toBeNull();
    expect(detail!.listing.daysOnMarket).toBe(3);
    expect(detail!.listing).not.toHaveProperty("listDate");
    // The history's "listed" event too (diffEvents).
    expect(detail!.events.map((e) => e.type)).toContain("listed");
    expectNoListDate(detail, "getListingBySlug");
  });

  it("carries a feed listing's history without dates (publicHistory)", async () => {
    const detail = await getListingBySlug(slug);
    expect(detail!.events.length).toBeGreaterThan(0);
    const json = JSON.stringify(detail!.events);
    expect(json).not.toContain("occurredAt");
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expectNoListDate(detail, "getListingBySlug");
  });

  it("keeps a manual listing's history dated", async () => {
    const detail = await getListingBySlug(manualSlug);
    expect(detail!.listing.fromFeed).toBe(false);
    const [listed] = detail!.events;
    expect(listed.type).toBe("listed");
    expect(listed.occurredAt).toEqual(new Date(`${manualListDate}T12:00:00Z`));
  });
});

describe("listing cards", () => {
  it("say whether a home is new, never when it was listed", async () => {
    expect(Object.keys(cardColumns)).not.toContain("listDate");
    const main = ids.get("main")!;
    const lists = {
      featured: await getFeaturedListings(50),
      newest: await getNewestListings(50),
      similar: await getSimilarListings({
        id: ids.get("seven")!,
        transactionType: "sale",
        listPrice: 300_002,
        city: "Royston",
        neighborhood: null,
      }),
      areaListings: await getAreaListings(findArea("royston")!, 50),
    };
    for (const [label, cards] of Object.entries(lists)) {
      const card = cards.find((c) => c.id === main);
      expect(card, label).toBeDefined();
      expect(card!.isNew, label).toBe(true);
      expectNoListDate(cards, label);
    }
    expectNoListDate(await getAreaFeaturedListing(findArea("royston")!), "area featured");
  });

  it("follow the New badge rule at its boundaries (isNewListing)", async () => {
    const cards = await withPhotos(
      db,
      await selectCards(db).where(inArray(listings.id, [...ids.values()])),
    );
    const want = {
      main: listDate,
      seven: boundary.seven,
      eight: boundary.eight,
      future: boundary.future,
      none: null,
    };
    for (const [key, date] of Object.entries(want)) {
      const card = cards.find((c) => c.id === ids.get(key));
      expect(card!.isNew, key).toBe(isNewListing(date, today));
    }
    expect(cards.filter((c) => c.isNew).length).toBe(2); // main (3 days), seven (7 days)
    expectNoListDate(cards, "cards");
  });
});

describe("search payloads", () => {
  const crit = (qs: string) => parseSearchParams(Object.fromEntries(new URLSearchParams(qs)));

  it("results and map pins carry no list date", async () => {
    for (const qs of ["sort=newest", "maxDaysOnMarket=7", "q=Royston&sort=newest"]) {
      const result = await searchListings(crit(qs));
      expect(
        result.items.map((i) => i.id),
        qs,
      ).toContain(ids.get("main"));
      expect(result.items.find((i) => i.id === ids.get("main"))!.isNew, qs).toBe(true);
      expectNoListDate(result, `searchListings ${qs}`);
      const pins = await searchMapPins(crit(qs));
      expect(
        pins.map((p) => p.id),
        qs,
      ).toContain(ids.get("main"));
      expectNoListDate(pins, `searchMapPins ${qs}`);
      expectNoListDate(await locationPins(crit(qs)), `locationPins ${qs}`);
    }
  });

  it("the location suggest API answers without one", async () => {
    // The county, not the town: towns come from `places`, which this test doesn't refresh.
    const suggestions = await getLocationSuggestions("Franklin");
    expect(suggestions.length).toBeGreaterThan(0);
    expectNoListDate(suggestions, "getLocationSuggestions");
    const res = await suggestRoute(
      new NextRequest("http://localhost/api/locations/suggest?q=Franklin"),
    );
    const body = await res.json();
    expect(body.suggestions.length).toBeGreaterThan(0);
    expectNoListDate(body, "/api/locations/suggest");
  });

  it("stats are numbers, not dates", async () => {
    const stats = await getMarketStats();
    expect(stats.newThisWeek).toBeGreaterThanOrEqual(2);
    expectNoListDate(stats, "getMarketStats");
    const area = await getAreaStats([findArea("royston")!]);
    expectNoListDate([...area], "getAreaStats");
  });

  it("alert emails select no list date", () => {
    expect(Object.keys(alertListingColumns)).not.toContain("listDate");
  });
});
