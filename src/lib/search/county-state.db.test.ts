import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { findSearchMatches } from "@/lib/alerts/queries";
import { getLocationSuggestions, getPlacesIndex } from "@/lib/listings/queries";
import { refreshPlaces } from "@/lib/listings/places";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { resolveCounty, resolveScope } from "./place";
import { searchListings } from "./service";

// County names repeat across states: Georgia's Clay County is not Alabama's or
// Florida's. A county scope matches Georgia listings only; a town or ZIP search
// still finds an out-of-state listing.

const crit = (q: string) => parseSearchParams(new URLSearchParams({ q }));
const cities = async (q: string) =>
  (await searchListings(crit(q))).items.map((l) => l.city).sort();

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(source, [
    listing(1, { city: "Fort Gaines", county: "Clay", postalCode: "39851" }),
    listing(2, { city: "Ashland", state: "AL", county: "Clay", postalCode: "36251" }),
    listing(3, {
      city: "Green Cove Springs",
      state: "FL",
      county: "Clay County",
      postalCode: "32043",
    }),
    // A county only out-of-state listings carry.
    listing(4, { city: "Sylacauga", state: "AL", county: "Talladega", postalCode: "35150" }),
  ]);
  await refreshPlaces(db);
});
afterAll(closeDb);

describe("a county scope", () => {
  it("searches Georgia's county only", async () => {
    for (const q of ["Clay County", "Clay Co", "Clay"]) {
      expect(await resolveScope(db, { q }), q).toEqual({ county: "Clay County" });
      expect(await cities(q), q).toEqual(["Fort Gaines"]);
      expect((await searchListings(crit(q))).total, q).toBe(1);
    }
  });

  it("suggests the county with Georgia's count", async () => {
    const counties = (await getLocationSuggestions("Clay")).filter((s) => s.kind === "county");
    expect(counties).toEqual([
      { kind: "county", label: "Clay", sublabel: "County", value: "Clay County", count: 1 },
    ]);
  });

  it("is no county when only out-of-state listings carry the name", async () => {
    expect(await resolveCounty(db, "Talladega County")).toBeUndefined();
    expect(await resolveCounty(db, "Talladega")).toBeUndefined();
    const out = await getLocationSuggestions("Talladega");
    expect(out.filter((s) => s.kind === "county")).toEqual([]);
  });

  it("a saved county search alerts on Georgia's county only", async () => {
    const now = new Date();
    const win = { start: new Date(0), end: now };
    const m = await findSearchMatches(
      db,
      crit("Clay County"),
      { listings: win, events: win },
      now,
    );
    expect(m.newRows.map((r) => r.city)).toEqual(["Fort Gaines"]);
  });
});

describe("an out-of-state listing", () => {
  it("is still found by its town and its ZIP", async () => {
    expect(await resolveScope(db, { q: "Ashland" })).toEqual({ town: "Ashland" });
    expect(await cities("Ashland")).toEqual(["Ashland"]);
    expect(await cities("36251")).toEqual(["Ashland"]);
    expect(await cities("Green Cove Springs")).toEqual(["Green Cove Springs"]);
  });

  it("is listed on /places under no county, not under Clay", async () => {
    expect(await getPlacesIndex()).toEqual([
      { county: "Clay", cities: [{ city: "Fort Gaines", count: 1 }] },
      {
        county: null,
        cities: [
          { city: "Ashland", count: 1 },
          { city: "Green Cove Springs", count: 1 },
          { city: "Sylacauga", count: 1 },
        ],
      },
    ]);
  });
});
