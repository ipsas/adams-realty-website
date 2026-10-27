import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { buildWhere } from "./query";

// The main-level bedroom filters match known values only: an unknown (null) never does.

const search = async (params: Record<string, string>) =>
  (
    await db
      .select({ key: listings.listingKey })
      .from(listings)
      .where(buildWhere(parseSearchParams(params)))
  )
    .map((r) => r.key)
    .sort();

const key = (i: number) => listing(i).listingKey;

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(source, [
    listing(1, { primaryBedroomOnMain: true, mainLevelBedrooms: 2 }),
    listing(2, { primaryBedroomOnMain: false, mainLevelBedrooms: 0 }),
    listing(3, { primaryBedroomOnMain: null, mainLevelBedrooms: null }),
    listing(4, { primaryBedroomOnMain: null, mainLevelBedrooms: 1 }),
  ]);
});

afterAll(closeDb);

describe("main-level bedroom filters", () => {
  it("primaryOnMain matches only a known yes (not no or unknown)", async () => {
    expect(await search({ primaryOnMain: "1" })).toEqual([key(1)]);
  });

  it("bedOnMain matches only one or more main-level bedrooms (not 0 or unknown)", async () => {
    expect(await search({ bedOnMain: "1" })).toEqual([key(1), key(4)].sort());
  });

  it("leaves every listing in without them", async () => {
    expect(await search({})).toHaveLength(4);
  });
});
