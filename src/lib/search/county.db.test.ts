import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { findSearchMatches } from "@/lib/alerts/queries";
import { getLocationSuggestions } from "@/lib/listings/queries";
import { refreshPlaces } from "@/lib/listings/places";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { placeBounds, resolveScope } from "./place";
import { searchListings, searchMapPins } from "./service";

// A county search against Postgres: "Hall County" (or a bare "Hall") is the
// county's homes however the feed spells it, not every "Hall Road" in the state;
// a town of the name still comes first.

const crit = (qs: string) => parseSearchParams(new URLSearchParams(qs));

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(source, [
    // Hall County, spelled three ways; one subdivision a feed named "Hall County".
    listing(1, { city: "Gainesville", county: "Hall", latitude: 34.3, longitude: -83.82 }),
    listing(2, {
      city: "Flowery Branch",
      county: "HALL COUNTY",
      latitude: 34.18,
      longitude: -83.92,
    }),
    listing(3, {
      city: "Clermont",
      county: "Hall",
      neighborhood: "Hall County",
      latitude: 34.47,
      longitude: -83.77,
    }),
    // A Hall Road in Macon: not Hall County.
    listing(4, {
      city: "Macon",
      county: "Bibb",
      addressLine1: "12 Hall Rd",
      latitude: 32.84,
      longitude: -83.63,
    }),
    // Forsyth, the town (Monroe County), and Forsyth County (Cumming).
    listing(5, { city: "Forsyth", county: "Monroe", latitude: 33.03, longitude: -83.94 }),
    listing(6, { city: "Cumming", county: "Forsyth", latitude: 34.21, longitude: -84.14 }),
    listing(7, { city: "Lawrenceville", county: "Gwinnett", latitude: 33.96, longitude: -83.99 }),
    // Clay County, one home, and three busier counties whose names start with "Clay".
    listing(8, { city: "Fort Gaines", county: "Clay", latitude: 31.6, longitude: -85.05 }),
    ...[9, 10, 11].map((i) => listing(i, { city: "Jonesboro", county: "Clayton" })),
    ...[12, 13].map((i) => listing(i, { city: "Riverdale", county: "Claymont" })),
    ...[14, 15].map((i) => listing(i, { city: "Morrow", county: "Clayborne" })),
  ]);
  await refreshPlaces(db);
});
afterAll(closeDb);

const cities = async (qs: string) =>
  (await searchListings(crit(qs))).items.map((l) => l.city).sort();

describe("a county search is that county only", () => {
  it("resolves a county, after a town of the name", async () => {
    expect(await resolveScope(db, { q: "Hall County" })).toEqual({ county: "Hall County" });
    expect(await resolveScope(db, { q: "hall county, ga" })).toEqual({ county: "Hall County" });
    expect(await resolveScope(db, { q: "Hall" })).toEqual({ county: "Hall County" });
    expect(await resolveScope(db, { q: "gwinnett" })).toEqual({ county: "Gwinnett County" });
    expect(await resolveScope(db, { q: "Forsyth" })).toEqual({ town: "Forsyth" });
    expect(await resolveScope(db, { q: "Forsyth County" })).toEqual({ county: "Forsyth County" });
    expect(await resolveScope(db, { q: "Gainesville" })).toEqual({ town: "Gainesville" });
    expect(await resolveScope(db, { q: "30601" })).toEqual({});
    expect(await resolveScope(db, { q: "Nowhere County" })).toEqual({});
  });

  it("'Hall County' and 'Hall' list the county's homes, not Hall Road", async () => {
    const hall = ["Clermont", "Flowery Branch", "Gainesville"];
    expect(await cities("q=Hall County")).toEqual(hall);
    expect(await cities("q=Hall")).toEqual(hall);
    expect(await cities("q=Forsyth County")).toEqual(["Cumming"]);
    expect(await cities("q=Forsyth")).toEqual(["Forsyth"]);
    expect(await searchMapPins(crit("q=Hall County"))).toHaveLength(3);
  });

  it("the map goes to the county's homes", async () => {
    const bounds = await placeBounds(db, "Hall County", { county: "Hall County" });
    expect(bounds).not.toBeNull();
    expect(bounds!.south).toBeLessThan(34.18);
    expect(bounds!.north).toBeGreaterThan(34.47);
    expect(bounds!.south).toBeGreaterThan(34);
  });

  it("a saved county search alerts on the county only", async () => {
    const now = new Date();
    const win = { start: new Date(0), end: now };
    const m = await findSearchMatches(
      db,
      crit("q=Hall County"),
      { listings: win, events: win },
      now,
    );
    expect(m.newRows.map((r) => r.city).sort()).toEqual([
      "Clermont",
      "Flowery Branch",
      "Gainesville",
    ]);
  });
});

describe("county suggestions", () => {
  it("offer the county first, not the subdivision named after it", async () => {
    for (const term of ["Hall", "Hall Co", "Hall County"]) {
      const out = await getLocationSuggestions(term);
      expect(out[0]).toEqual({
        kind: "county",
        label: "Hall",
        sublabel: "County",
        value: "Hall County",
        count: 3,
      });
      expect(out.filter((s) => s.kind === "neighborhood")).toEqual([]);
    }
  });

  it("offer a county typed in lower case", async () => {
    const out = await getLocationSuggestions("gwinnett");
    expect(out[0]).toMatchObject({ kind: "county", value: "Gwinnett County", count: 1 });
  });

  it("offer the county named as typed even when busier ones share its prefix", async () => {
    for (const term of ["Clay County", "Clay"]) {
      const out = await getLocationSuggestions(term);
      expect(out[0], term).toEqual({
        kind: "county",
        label: "Clay",
        sublabel: "County",
        value: "Clay County",
        count: 1,
      });
    }
  });
});
