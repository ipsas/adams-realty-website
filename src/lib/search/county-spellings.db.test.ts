import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { getLocationSuggestions } from "@/lib/listings/queries";
import { refreshPlaces } from "@/lib/listings/places";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { searchHeading } from "./heading";
import { parseSearchParams } from "./params";
import { resolveScope } from "./place";
import { countListings, searchListings } from "./service";

// QA L21: a half-typed County word or state ("Hall Co", "Hall County, G") still
// names the county; DeKalb, McDuffie and McIntosh are found however they are
// spelled; and the county suggestion's count is the results page's total.

const crit = (q: string) => parseSearchParams(new URLSearchParams({ q }));
const total = async (q: string) => (await searchListings(crit(q))).total;

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  let i = 0;
  const at = (county: string, over: Parameters<typeof listing>[1] = {}) =>
    listing(++i, { city: "Gainesville", county, ...over });
  await insertListings(source, [
    // Hall: two homes for sale (the default buy search), and six it leaves out
    // (coming soon is hidden from the public by the IDX rules).
    at("Hall"),
    at("HALL"),
    at("Hall", { status: "coming_soon" }),
    at("Hall", { status: "pending" }),
    at("Hall", { status: "active_under_contract" }),
    at("Hall", { status: "closed", closePrice: 250_000 }),
    at("Hall", { transactionType: "rent", listPrice: 1_800 }),
    at("Hall", { propertyType: "commercial" }),
    // Jackson, the town (Butts County), and Jackson County (Jefferson).
    at("Butts", { city: "Jackson" }),
    at("Jackson", { city: "Jefferson" }),
    // DeKalb as feeds spell it: capitals, split, plain title case.
    at("DEKALB", { city: "Decatur" }),
    at("DEKALB", { city: "Decatur" }),
    at("De Kalb", { city: "Tucker" }),
    at("Dekalb", { city: "Stone Mountain" }),
    // McDuffie in capitals and split.
    at("MCDUFFIE", { city: "Thomson" }),
    at("Mc Duffie", { city: "Dearing" }),
    // A county with only pending homes: nothing for sale to suggest.
    at("Lincoln", { city: "Lincolnton", status: "pending" }),
  ]);
  await refreshPlaces(db);
});
afterAll(closeDb);

describe("a half-typed County word or state (QA L21-1, L21-2)", () => {
  it("'Hall Co' searches Hall County, headed as such", async () => {
    for (const q of ["Hall Co", "hall cou", "Hall County, G", "Hall Co, Georgia", "Hall, GA"]) {
      const scope = await resolveScope(db, { q });
      expect(scope, q).toEqual({ county: "Hall County" });
      expect(searchHeading(crit(q), scope)).toBe("Homes for sale in Hall County");
      expect(await total(q), q).toBe(2);
    }
  });

  it("'Hall County, G' suggests Hall County", async () => {
    for (const term of ["Hall County, G", "Hall County, Ga", "Hall Co, Georgia", "Hall, GA"]) {
      const out = await getLocationSuggestions(term);
      expect(out[0], term).toEqual({
        kind: "county",
        label: "Hall",
        sublabel: "County",
        value: "Hall County",
        count: 2,
      });
    }
  });

  it("a town of the name still wins over its county", async () => {
    expect(await resolveScope(db, { q: "Jackson" })).toEqual({ town: "Jackson" });
    expect(await resolveScope(db, { q: "Jackson County" })).toEqual({ county: "Jackson County" });
    expect(await resolveScope(db, { q: "Jackson Co" })).toEqual({ county: "Jackson County" });
  });

  it("text that isn't a county stays a text search", async () => {
    expect(await resolveScope(db, { q: "Hall Cove" })).toEqual({});
    expect(await resolveScope(db, { q: "Hall G" })).toEqual({});
  });
});

describe("DeKalb, McDuffie and McIntosh spelled any way", () => {
  it("resolve to the county, with the same homes as its proper name", async () => {
    const dekalb = await total("DeKalb County");
    expect(dekalb).toBe(4);
    for (const q of ["De Kalb", "de kalb county", "Dekalb", "DEKALB County", "De'Kalb"]) {
      expect(await resolveScope(db, { q }), q).toEqual({ county: "DeKalb County" });
      expect(await total(q), q).toBe(dekalb);
    }
    const mcduffie = await total("McDuffie County");
    expect(mcduffie).toBe(2);
    for (const q of ["Mc Duffie", "McDuffie", "mc'duffie county", "mc duffie county"]) {
      expect(await resolveScope(db, { q }), q).toEqual({ county: "McDuffie County" });
      expect(await total(q), q).toBe(mcduffie);
    }
  });

  it("suggest one county, shown properly, from any spelling or start of it", async () => {
    for (const term of ["DeKalb", "De Kalb", "dekalb", "De Ka", "Dek"]) {
      const counties = (await getLocationSuggestions(term)).filter((s) => s.kind === "county");
      expect(counties, term).toEqual([
        { kind: "county", label: "DeKalb", sublabel: "County", value: "DeKalb County", count: 4 },
      ]);
    }
    for (const term of ["Mc Duf", "mcdu", "McDuffie", "Mc'Duffie"]) {
      const counties = (await getLocationSuggestions(term)).filter((s) => s.kind === "county");
      expect(counties, term).toEqual([
        {
          kind: "county",
          label: "McDuffie",
          sublabel: "County",
          value: "McDuffie County",
          count: 2,
        },
      ]);
    }
  });
});

describe("the county suggestion's count (QA D)", () => {
  it("is the results page's total for the county search", async () => {
    const [hall] = await getLocationSuggestions("Hall County");
    expect(hall.count).toBe(await total("Hall County"));
    expect(hall.count).toBe(await countListings(crit("Hall County")));
  });

  it("leaves out a county with nothing for sale", async () => {
    const out = await getLocationSuggestions("Lincoln");
    expect(out.filter((s) => s.kind === "county")).toEqual([]);
  });
});
