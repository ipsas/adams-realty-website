import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { getTopCities } from "./queries";

// The home page's town chips and the footer's towns: the cities with the most
// homes for sale, busiest first. Names are chosen so that A–Z order differs
// from busiest-first at every position.

const FOR_SALE: Record<string, number> = { Zebulon: 4, Macon: 3, Savannah: 2, Athens: 1 };

beforeAll(async () => {
  await resetDb();
  const feed = await createSource();
  let key = 0;
  const rows = Object.entries(FOR_SALE).flatMap(([city, n]) =>
    Array.from({ length: n }, () => listing(++key, { city })),
  );
  // Rows that aren't homes for sale don't count: rentals, sold, pending and a hidden status.
  rows.push(
    listing(++key, { city: "Athens", transactionType: "rent" }),
    listing(++key, { city: "Athens", transactionType: "rent" }),
    listing(++key, { city: "Athens", status: "closed", closeDate: "2026-09-10" }),
    listing(++key, { city: "Athens", status: "pending" }),
    listing(++key, { city: "Athens", status: "withdrawn" }),
    listing(++key, { city: "Athens", status: "expired" }),
  );
  await insertListings(feed, rows);
});

afterAll(closeDb);

describe("getTopCities", () => {
  it("ranks cities by homes for sale, busiest first", async () => {
    expect(await getTopCities()).toEqual([
      { city: "Zebulon", count: 4 },
      { city: "Macon", count: 3 },
      { city: "Savannah", count: 2 },
      { city: "Athens", count: 1 },
    ]);
  });

  it("keeps the busiest when it cuts the list", async () => {
    expect((await getTopCities(2)).map((c) => c.city)).toEqual(["Zebulon", "Macon"]);
  });
});
