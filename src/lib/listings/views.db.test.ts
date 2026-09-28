import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { getDailyViewTotals, getListingViews, recordListingView } from "./views";

// Listing page views for Georgia MLS traffic statistics: one counter per
// listing per market day, summed over a range by the dashboard and its CSV.

let feedIds: string[];
let manualId: string;

// 11:30pm and 12:30am in Georgia (EDT, UTC-4): two market days.
const lateMonday = new Date("2026-09-22T03:30:00Z");
const earlyTuesday = new Date("2026-09-22T04:30:00Z");

beforeAll(async () => {
  await resetDb();
  const feed = await createSource();
  const manual = await createSource({ slug: "adams", kind: "manual", config: {} });
  feedIds = await insertListings(feed, [listing(1), listing(2)]);
  [manualId] = await insertListings(manual, [listing(3)]);
  for (let i = 0; i < 3; i++) await recordListingView(db, feedIds[0], lateMonday);
  await recordListingView(db, feedIds[0], earlyTuesday);
  await recordListingView(db, feedIds[1], earlyTuesday);
  await recordListingView(db, manualId, earlyTuesday);
  await recordListingView(db, manualId, earlyTuesday);
});

afterAll(closeDb);

describe("listing views", () => {
  it("count per market day", async () => {
    expect(await getDailyViewTotals(db, { from: "2026-09-01", to: "2026-09-30" })).toEqual([
      { day: "2026-09-21", views: 3, listings: 1 },
      { day: "2026-09-22", views: 4, listings: 3 },
    ]);
  });

  it("sum over a range, busiest first", async () => {
    const rows = await getListingViews(db, { from: "2026-09-21", to: "2026-09-22" });
    expect(rows.map((r) => [r.listingId, r.views])).toEqual([
      [feedIds[0], 4],
      [manualId, 2],
      [feedIds[1], 1],
    ]);
    const tuesday = await getListingViews(db, { from: "2026-09-22", to: "2026-09-22" });
    expect(tuesday.find((r) => r.listingId === feedIds[0])?.views).toBe(1);
  });

  it("keep only Georgia MLS listings on request", async () => {
    const rows = await getListingViews(
      db,
      { from: "2026-09-21", to: "2026-09-22" },
      { feedOnly: true },
    );
    expect(rows.map((r) => r.listingId).sort()).toEqual([...feedIds].sort());
    expect(rows.every((r) => r.fromFeed && r.mlsNumber)).toBe(true);
  });
});
