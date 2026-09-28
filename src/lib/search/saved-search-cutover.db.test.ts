import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { asc, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { db } from "@/db";
import { savedSearches, users } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams, serializeCriteria, type SearchCriteria } from "./params";
import { searchListings } from "./service";

// drizzle/0009: saved searches made while the site was regional, with no
// location, must not widen to the whole state at the statewide cutover.
// The test database already ran every migration (on empty tables), so the
// statement is replayed here against rows written the way users wrote them.

const MIGRATION = readFileSync(
  fileURLToPath(new URL("../../../drizzle/0009_saved_search_cutover.sql", import.meta.url)),
  "utf8",
);

const base = { mode: "buy", sort: "newest", page: 1 } as const;
const SEARCHES: Record<string, SearchCriteria> = {
  noLocation: { ...base, beds: 3, maxPrice: 400_000 } as SearchCriteria,
  emptyQ: { ...base, q: "" } as SearchCriteria,
  bareGeorgia: { ...base, q: "Georgia" } as SearchCriteria,
  bareGa: { ...base, q: " ga " } as SearchCriteria,
  georgiaUsa: { ...base, q: "Georgia, USA" } as SearchCriteria,
  royston: { ...base, q: "Royston", beds: 3 } as SearchCriteria,
  georgiaClub: { ...base, q: "The Georgia Club" } as SearchCriteria,
  mapArea: {
    ...base,
    bounds: { west: -81.2, south: 31.9, east: -81.0, north: 32.1 },
  } as SearchCriteria,
};

async function stored(): Promise<Record<string, SearchCriteria>> {
  const rows = await db
    .select({ name: savedSearches.name, criteria: savedSearches.criteria })
    .from(savedSearches)
    .orderBy(asc(savedSearches.name));
  return Object.fromEntries(rows.map((r) => [r.name, r.criteria]));
}

/** What the alert run does with stored criteria (lib/alerts/run.ts normalizeCriteria). */
const reparse = (c: SearchCriteria) => ({ ...parseSearchParams(serializeCriteria(c)), page: 1 });

let before: Record<string, SearchCriteria>;
let after: Record<string, SearchCriteria>;

beforeAll(async () => {
  await resetDb();
  await db.execute(sql`truncate table users cascade`);
  const [user] = await db
    .insert(users)
    .values({ id: "cutover-user", name: "Pat Buyer", email: "pat@example.com" })
    .returning();
  await db
    .insert(savedSearches)
    .values(
      Object.entries(SEARCHES).map(([name, criteria]) => ({ userId: user.id, name, criteria })),
    );

  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  await insertListings(source, [
    // Royston, Franklin County: inside the firm's area.
    listing(1, {
      city: "Royston",
      county: "Franklin",
      bedrooms: 3,
      listPrice: 250_000,
      latitude: 34.287,
      longitude: -83.11,
    }),
    // Savannah, Chatham County: the same search, far outside it.
    listing(2, {
      city: "Savannah",
      county: "Chatham",
      bedrooms: 3,
      listPrice: 250_000,
      latitude: 32.08,
      longitude: -81.09,
    }),
  ]);

  before = await stored();
  await db.execute(sql.raw(MIGRATION));
  after = await stored();
});

afterAll(async () => {
  await db.delete(users).where(eq(users.id, "cutover-user"));
  await closeDb();
});

describe("0009 saved-search cutover", () => {
  it("uses the firm's bounds from site.ts", () => {
    const b = site.market.bounds;
    expect(MIGRATION).toContain(
      `'west', ${b.west}, 'south', ${b.south}, 'east', ${b.east}, 'north', ${b.north}`,
    );
  });

  it("pins every search with no location to the firm's counties", () => {
    for (const name of ["noLocation", "emptyQ", "bareGeorgia", "bareGa", "georgiaUsa"]) {
      expect(after[name].bounds, name).toEqual(site.market.bounds);
      expect(after[name].q, name).toBeUndefined();
    }
    // Everything else the buyer chose is kept.
    expect(after.noLocation).toEqual({ ...SEARCHES.noLocation, bounds: site.market.bounds });
  });

  it("leaves searches with a place or their own map area alone", () => {
    for (const name of ["royston", "georgiaClub", "mapArea"]) {
      expect(after[name], name).toEqual(before[name]);
    }
  });

  it("keeps a pinned search to the homes it used to mean, not the whole state", async () => {
    const cities = async (c: SearchCriteria) =>
      (await searchListings(reparse(c))).items.map((i) => i.city).sort();
    // Before: statewide (the widening the migration prevents).
    expect(await cities(before.noLocation)).toEqual(["Royston", "Savannah"]);
    expect(await cities(after.noLocation)).toEqual(["Royston"]);
    expect(await cities(after.bareGeorgia)).toEqual(["Royston"]);
  });

  it("is safe to run twice", async () => {
    await db.execute(sql.raw(MIGRATION));
    expect(await stored()).toEqual(after);
  });
});
