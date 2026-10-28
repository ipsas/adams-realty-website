import { and, count, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Area } from "@/config/areas";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { areaCondition } from "./match";
import {
  getAreaFeaturedListing,
  getAreaListingCount,
  getAreaListings,
  getAreaStats,
} from "./queries";

// getAreaStats' hash join against Postgres. Names repeat across a statewide
// feed, so each of its three ways in (neighborhood, lake, city) must keep a
// listing only when it is in one of the area's counties, or has no county.

const area = (over: Partial<Area> & Pick<Area, "slug" | "name" | "city" | "counties">): Area => ({
  region: "madison-jackson",
  description: "",
  highlights: [],
  center: { lat: 34, lng: -83 },
  updated: "2026-01-01",
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

const royston = area({
  slug: "royston",
  name: "Royston",
  city: "Royston",
  counties: ["Franklin"],
});
const comer = area({
  slug: "comer",
  name: "Comer",
  city: "Comer",
  counties: ["Madison"],
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
    // Royston (QA R35 C-L1): three real homes, plus listings the guide leaves
    // out (showcaseListing): street number 0, and no living area over the cap.
    ...[200_000, 300_000, 400_000].map((listPrice) =>
      home({ city: "Royston", county: "Franklin", listPrice, livingAreaSqft: 1_800 }),
    ),
    home({
      city: "Royston",
      county: "Franklin",
      addressLine1: "0 Franklin Springs St",
      listPrice: 6_000_000,
      livingAreaSqft: 2_000,
    }),
    home({ city: "Royston", county: "Franklin", listPrice: 5_000_000, livingAreaSqft: null }),
    // Comer: only such listings.
    home({ city: "Comer", county: "Madison", addressLine1: "0 Main St", livingAreaSqft: 1_500 }),
    home({ city: "Comer", county: "Madison", listPrice: 2_500_000, livingAreaSqft: null }),
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

  it("counts for sale only the homes the guide's grid draws from (QA R35 C-L1)", async () => {
    const stats = (await getAreaStats([royston])).get("royston")!;
    expect(stats.forSale).toBe(3);
    expect(await getAreaListingCount(royston)).toBe(3);
    expect(stats.medianListPrice).toBe(300_000);
    expect(stats.maxListPrice).toBe(400_000);
    const homes = await getAreaListings(royston);
    expect(homes.map((h) => h.listPrice).sort((a, b) => a - b)).toEqual([200_000, 300_000, 400_000]);
    expect((await getAreaFeaturedListing(royston))?.listPrice).toBe(400_000);
  });

  it("reports nothing for sale where every listing is left off the guide (QA R35 C-L2)", async () => {
    const stats = (await getAreaStats([comer])).get("comer")!;
    expect(stats.forSale).toBe(0);
    expect(stats.medianListPrice).toBeNull();
    expect(await getAreaListingCount(comer)).toBe(0);
    expect(await getAreaListings(comer)).toEqual([]);
    expect(await getAreaFeaturedListing(comer)).toBeNull();
  });
});
