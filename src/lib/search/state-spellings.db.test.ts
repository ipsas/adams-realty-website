import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { findSearchMatches } from "@/lib/alerts/queries";
import { refreshPlaces } from "@/lib/listings/places";
import { getLocationSuggestions } from "@/lib/listings/queries";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { searchListings } from "./service";

// Listings are stored with state "GA" (normalizeState), but rows written
// before that may hold "Georgia" or stray case and spaces: a county scope
// still finds them. A row with an empty state is never Georgia's.

const listDate = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const crit = parseSearchParams(new URLSearchParams({ q: "Hall County" }));

let ids: string[];
let georgia: string[];
let blank: string;

beforeAll(async () => {
  await resetDb();
  const source = await createSource({ slug: "adams", kind: "manual", config: {} });
  ids = await insertListings(
    source,
    [1, 2, 3, 4, 5, 6, 7].map((i) =>
      listing(i, {
        city: "Gainesville",
        county: "Hall",
        postalCode: "30501",
        listDate,
        state: i === 1 ? "Georgia" : "GA",
      }),
    ),
  );
  // Forced past the writer, as an older row would be.
  const forced = ["Georgia", "GEORGIA", " GA", "ga", ""];
  for (const [i, state] of forced.entries()) {
    await db.update(listings).set({ state }).where(eq(listings.id, ids[i + 1]));
  }
  blank = ids[5];
  georgia = ids.filter((id) => id !== blank);
  await refreshPlaces(db);
});
afterAll(closeDb);

describe("a listing's state", () => {
  it("is stored as GA when written as Georgia", async () => {
    const [row] = await db
      .select({ state: listings.state })
      .from(listings)
      .where(eq(listings.id, ids[0]));
    expect(row.state).toBe("GA");
  });
});

describe("a county scope", () => {
  it("finds Georgia's rows in any spelling, and not an empty state", async () => {
    const res = await searchListings(crit);
    expect(res.items.map((l) => l.id).sort()).toEqual([...georgia].sort());
    expect(res.total).toBe(georgia.length);
  });

  it("counts them in the county suggestion", async () => {
    const counties = (await getLocationSuggestions("Hall")).filter((s) => s.kind === "county");
    expect(counties).toEqual([
      expect.objectContaining({ value: "Hall County", count: georgia.length }),
    ]);
  });

  it("alerts on them", async () => {
    const now = new Date();
    const win = { start: new Date(0), end: now };
    const m = await findSearchMatches(db, crit, { listings: win, events: win }, now);
    expect(m.newRows.map((r) => r.id).sort()).toEqual([...georgia].sort());
  });
});
