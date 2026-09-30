import { and, count, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Area } from "@/config/areas";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { areaCondition } from "./match";
import { getAreaStats } from "./queries";

// getAreaStats' hash join against Postgres. Names repeat across a statewide
// feed, so each of its three ways in (neighborhood, lake, city) must keep a
// listing only when it is in one of the area's counties, or has no county.

const area = (over: Partial<Area> & Pick<Area, "slug" | "name" | "city" | "counties">): Area => ({
  region: "madison-jackson",
  description: "",
  highlights: [],
  center: { lat: 34, lng: -83 },
  ...over,
});

const jefferson = area({
  slug: "jefferson",
  name: "Jefferson",
  city: "Jefferson",
  counties: ["Jackson"],
});
const hartwellLake = area({
  slug: "lake-hartwell",
  name: "Lake Hartwell",
  city: "Hartwell",
  counties: ["Hart", "Franklin", "Stephens"],
  aliases: ["Hartwell Lake"],
});
const carnesville = area({
  slug: "carnesville",
  name: "Carnesville",
  city: "Carnesville",
  counties: ["Franklin"],
});
const subdivision = area({
  slug: "reunion",
  name: "Reunion",
  city: "Hoschton",
  counties: ["Hall"],
});

let i = 0;
const home = (over: Parameters<typeof listing>[1]) => listing(++i, { city: "Elsewhere", ...over });

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(source, [
    // City: Jefferson, Jackson County, counts; so does one with no county.
    home({ city: "Jefferson", county: "Jackson" }),
    home({ city: "JEFFERSON", county: "Jackson County" }),
    home({ city: "Jefferson", county: null }),
    // …but not Jefferson in Camden County (a different town of the same name).
    home({ city: "Jefferson", county: "Camden" }),
    home({ city: "Jefferson", county: "Camden" }),
    // Lake (water_body): Lake Hartwell in Hart or Franklin County counts…
    home({ city: "Hartwell", county: "Hart", waterBodyName: "Lake Hartwell" }),
    home({ city: "Lavonia", county: "Franklin", waterBodyName: "Hartwell Lake" }),
    // …a pond with the same name in Fulton County doesn't.
    home({ city: "Atlanta", county: "Fulton", waterBodyName: "Lake Hartwell" }),
    home({ city: "Atlanta", county: "Fulton", waterBodyName: "Lake Hartwell" }),
    home({ city: "Atlanta", county: "Fulton", waterBodyName: "Lake Hartwell" }),
    // Neighborhood: Reunion in Hall County counts; a Reunion subdivision in Cobb doesn't.
    home({ city: "Hoschton", county: "Hall", neighborhood: "Reunion" }),
    home({ city: "Marietta", county: "Cobb", neighborhood: "Reunion" }),
    home({ city: "Marietta", county: "Cobb", neighborhood: "Reunion" }),
    home({ city: "Marietta", county: "Cobb", neighborhood: "Reunion" }),
    home({ city: "Marietta", county: "Cobb", neighborhood: "Reunion" }),
    // Carnesville land (site review #8): $10,000, $5,500 and $6,024 an acre…
    ...[
      [100_000, 10],
      [220_000, 40],
      [1_000_000, 166],
    ].map(([price, acres]) =>
      home({
        city: "Carnesville",
        county: "Franklin",
        propertyType: "land",
        listPrice: price,
        lotSizeSqft: acres * 43_560,
      }),
    ),
    // …and what the per-acre median leaves out: a farm with a house, land with no
    // size, a house, and sold land.
    home({
      city: "Carnesville",
      county: "Franklin",
      propertyType: "farm_ranch",
      listPrice: 900_000,
      lotSizeSqft: 20 * 43_560,
      livingAreaSqft: 2_400,
      bedrooms: 4,
    }),
    home({ city: "Carnesville", county: "Franklin", propertyType: "land", lotSizeSqft: null }),
    home({ city: "Carnesville", county: "Franklin", lotSizeSqft: 43_560 }),
    home({
      city: "Carnesville",
      county: "Franklin",
      propertyType: "land",
      status: "closed",
      closePrice: 10_000,
      lotSizeSqft: 43_560,
    }),
  ]);
});
afterAll(closeDb);

/** What the area's own guide page lists (areaCondition), counted directly. */
async function direct(a: Area) {
  const [{ n }] = await db
    .select({ n: count() })
    .from(listings)
    .where(and(isNull(listings.removedAt), eq(listings.status, "active"), areaCondition(a)));
  return n;
}

describe("getAreaStats", () => {
  it("keeps each area to its own counties, on every way a listing can match", async () => {
    const stats = await getAreaStats([jefferson, hartwellLake, subdivision]);
    expect(stats.get("jefferson")!.forSale).toBe(3);
    expect(stats.get("lake-hartwell")!.forSale).toBe(2);
    expect(stats.get("reunion")!.forSale).toBe(1);
  });

  it("gives land's median price per acre, from bare tracts for sale with a size", async () => {
    const stats = (await getAreaStats([carnesville])).get("carnesville")!;
    expect(stats.pricePerAcreSample).toBe(3);
    expect(stats.medianPricePerAcre).toBe(6024);
    // Areas with no land report none.
    expect((await getAreaStats([subdivision])).get("reunion")!.pricePerAcreSample).toBe(0);
  });

  it("agrees with the guide page's own listing query", async () => {
    const stats = await getAreaStats([jefferson, hartwellLake, subdivision]);
    for (const a of [jefferson, hartwellLake, subdivision]) {
      expect(stats.get(a.slug)!.forSale, a.slug).toBe(await direct(a));
    }
  });
});
