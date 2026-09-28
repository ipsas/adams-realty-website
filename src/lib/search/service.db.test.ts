import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { buildOrderBy, buildWhere } from "./query";
import { locationPins, searchMapPins } from "./service";

// A location search's pins are either walked off the order index or collected
// from all its matches (`locationPins`); both must be the first matches in the
// search's order.

const crit = (qs: string) => parseSearchParams(Object.fromEntries(new URLSearchParams(qs)));

/** The first `limit` matches in the search's order, the straightforward way. */
async function walked(qs: string, limit: number) {
  const c = crit(qs);
  const rows = await db
    .select({ id: listings.id })
    .from(listings)
    .where(buildWhere(c))
    .orderBy(...buildOrderBy(c))
    .limit(limit);
  return rows.map((r) => r.id);
}

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  // Dates relative to today: sold mode only shows the last year's sales.
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  await insertListings(source, [
    // 14 homes for sale in Testville, with varied order keys (ties included)…
    ...Array.from({ length: 14 }, (_, i) =>
      listing(i, {
        city: "Testville",
        listDate: daysAgo(30 - (i % 5)),
        listPrice: 200_000 + ((i * 7919) % 13) * 10_000,
        livingAreaSqft: 1000 + ((i * 31) % 7) * 150,
        latitude: 33.5 + i / 1000,
        longitude: -84.2,
      }),
    ),
    // …6 sold there…
    ...Array.from({ length: 6 }, (_, i) =>
      listing(100 + i, {
        city: "Testville",
        status: "closed",
        closeDate: daysAgo(20 - i),
        closePrice: 250_000 + i * 1000,
        latitude: 33.6,
        longitude: -84.2 - i / 1000,
      }),
    ),
    // …and homes elsewhere that must not show.
    ...Array.from({ length: 5 }, (_, i) =>
      listing(200 + i, { city: "Otherton", latitude: 34, longitude: -83 - i / 1000 }),
    ),
  ]);
});
afterAll(closeDb);

describe("locationPins", () => {
  it.each(["q=Testville", "q=Testville&sort=price_asc", "q=Testville&sort=sqft_desc"])(
    "%s: the first matches in the search's order",
    async (qs) => {
      const pins = await locationPins(crit(qs), 5);
      expect(pins.map((p) => p.id)).toEqual(await walked(qs, 5));
    },
  );

  it("works for sold homes, pinned at their sale price", async () => {
    const pins = await locationPins(crit("mode=sold&q=Testville"), 4);
    expect(pins.map((p) => p.id)).toEqual(await walked("mode=sold&q=Testville", 4));
    expect(pins.every((p) => p.status === "closed" && p.price >= 250_000)).toBe(true);
  });

  it("finds nothing for a place with no homes", async () => {
    expect(await locationPins(crit("q=Nowhereville"))).toEqual([]);
  });
});

describe("searchMapPins", () => {
  it.each(["q=Testville&sort=newest", "mode=sold&q=Testville", ""])(
    "%s: every match, in the search's order",
    async (qs) => {
      const pins = await searchMapPins(crit(qs));
      expect(pins.length).toBeGreaterThan(0);
      expect(pins.map((p) => p.id)).toEqual(await walked(qs, 750));
    },
  );
});
