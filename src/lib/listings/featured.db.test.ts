import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { isFirmArea } from "@/lib/areas/firm-area";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { getFeaturedListings } from "./queries";

// "Handpicked by our agents" (home page) with a statewide feed: only the
// firm's own listings and homes in its area qualify, and the SQL filter agrees
// with isFirmArea, which the listing page uses for tours.

const FEED = [
  { key: 1, city: "Royston", county: "Franklin" },
  { key: 2, city: "Savannah", county: "Chatham" },
  {
    key: 3,
    city: "Cumming",
    county: "Forsyth",
    neighborhood: "Harbour Point",
    waterBodyName: "Lake Sidney Lanier",
  },
  { key: 4, city: "Cumming", county: "Forsyth", neighborhood: "Vickery" },
  { key: 5, city: "Savannah", county: "Chatham", neighborhood: "Jefferson" },
  { key: 6, city: "Royston", county: null },
  { key: 7, city: "Braselton", county: "Barrow" },
  { key: 8, city: "Atlanta", county: "Fulton" },
];

let featuredCities: string[];

beforeAll(async () => {
  await resetDb();
  const mls = await createSource();
  await insertListings(
    mls,
    FEED.map(({ key, ...where }) => listing(key, { neighborhood: null, ...where })),
  );
  // Adams Realty's own listing (manual source = company listing), outside its usual area.
  const adams = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(adams, [listing(100, { city: "Valdosta", county: "Lowndes" })]);
  featuredCities = (await getFeaturedListings(20)).map((l) => l.city).sort();
});

afterAll(closeDb);

describe("getFeaturedListings", () => {
  it("keeps the firm's listings and firm-area homes, and nothing else", () => {
    expect(featuredCities).toEqual(["Braselton", "Cumming", "Royston", "Valdosta"]);
  });

  it("agrees with isFirmArea for every feed listing", async () => {
    const rows = await db
      .select({
        id: listings.id,
        state: listings.state,
        city: listings.city,
        county: listings.county,
        neighborhood: listings.neighborhood,
        waterBodyName: listings.waterBodyName,
        isCompanyListing: listings.isCompanyListing,
      })
      .from(listings);
    const featuredIds = new Set((await getFeaturedListings(20)).map((l) => l.id));
    for (const r of rows) {
      expect(featuredIds.has(r.id), `${r.city}, ${r.county}, ${r.neighborhood}`).toBe(
        r.isCompanyListing || isFirmArea(r),
      );
    }
  });
});
