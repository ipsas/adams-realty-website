import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { findArea } from "@/config/areas";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { getAreaStats } from "@/lib/areas/queries";
import { addDays, marketToday } from "@/lib/areas/stats";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { parseSearchParams } from "./params";
import { locationPins, searchListings, searchMapPins } from "./service";

// QA N1: a pending or under-contract feed listing shows no days on market, so its list date
// (Georgia MLS's OnMarketDate, Exhibit C) may not decide whether it matches the "Days on
// market" filter, nor where "Newest" puts it: that orders it by when it became public.
// Manual listings keep their list date everywhere.

const today = marketToday();
const daysAgo = (n: number) => addDays(today, -n);
/** An instant on the market date `n` days ago. */
const publicDaysAgo = (n: number) => new Date(`${daysAgo(n)}T16:00:00Z`);

const royston = {
  city: "Royston",
  county: "Franklin",
  postalCode: "30662",
  latitude: 34.287,
  longitude: -83.11,
};
const ids = new Map<string, string>();
let feed: Awaited<ReturnType<typeof createSource>>;
let manual: Awaited<ReturnType<typeof createSource>>;

beforeAll(async () => {
  await resetDb();
  feed = await createSource();
  manual = await createSource({ slug: "adams", kind: "manual", config: {} });
  // [key, source, listing, public since (days ago)]
  const rows = [
    // The repro: listed 6 days ago, public since today.
    ["pending6", feed, listing(1, { ...royston, status: "pending", listDate: daysAgo(6) }), 0],
    // List date order opposite to public order.
    ["pendingA", feed, listing(2, { ...royston, status: "pending", listDate: daysAgo(20) }), 1],
    [
      "pendingB",
      feed,
      listing(3, { ...royston, status: "active_under_contract", listDate: daysAgo(10) }),
      15,
    ],
    ["active", feed, listing(4, { ...royston, listDate: daysAgo(3) }), 3],
    // Manual, the same opposition: still by list date.
    ["manualA", manual, listing(5, { ...royston, status: "pending", listDate: daysAgo(2) }), 30],
    ["manualB", manual, listing(6, { ...royston, status: "pending", listDate: daysAgo(12) }), 0],
    ["manual6", manual, listing(7, { ...royston, status: "pending", listDate: daysAgo(6) }), 40],
  ] as const;
  for (const [key, source, l, since] of rows) {
    const [id] = await insertListings(source, [l]);
    await db
      .update(listings)
      .set({ publicSince: publicDaysAgo(since) })
      .where(eq(listings.id, id));
    ids.set(key, id);
  }
});
afterAll(closeDb);

const crit = (qs: string) =>
  parseSearchParams(Object.fromEntries(new URLSearchParams(`q=Royston&pending=1&${qs}`)));
const found = async (qs: string) => (await searchListings(crit(qs))).items.map((i) => i.id);
const id = (key: string) => ids.get(key)!;

describe("the Days on market filter", () => {
  it("never flips on a pending feed listing's hidden list date: excluded at 5 and at 6", async () => {
    const five = await found("maxDaysOnMarket=5");
    const six = await found("maxDaysOnMarket=6");
    expect(five).not.toContain(id("pending6"));
    expect(six).not.toContain(id("pending6"));
    // Only what shows days on market, and manual listings, match.
    expect(new Set(five)).toEqual(new Set([id("active"), id("manualA")]));
    expect(new Set(six)).toEqual(new Set([id("active"), id("manualA"), id("manual6")]));
  });

  it("still matches an active feed listing by its days on market", async () => {
    expect(await found("maxDaysOnMarket=3")).toContain(id("active"));
    expect(await found("maxDaysOnMarket=2")).not.toContain(id("active"));
  });

  it("keeps a manual listing's behavior: by its list date, whatever its status", async () => {
    expect(await found("maxDaysOnMarket=5")).not.toContain(id("manual6"));
    expect(await found("maxDaysOnMarket=6")).toContain(id("manual6"));
  });
});

describe("Newest", () => {
  // Days ago by the public key: pending6 0, pendingA 1, manualA 2 (list date), active 3,
  // manual6 6 (list date), manualB 12 (list date), pendingB 15. By list date alone pending6
  // would tie manual6, pendingB come before manualB and pendingA last.
  const expected = () =>
    ["pending6", "pendingA", "manualA", "active", "manual6", "manualB", "pendingB"].map(id);

  it("orders pending feed listings by when they became public, not by list date", async () => {
    const order = await found("sort=newest");
    expect(order).toEqual(expected());
    expect(order.indexOf(id("pendingA"))).toBeLessThan(order.indexOf(id("pendingB")));
  });

  it("orders manual listings by list date, as before", async () => {
    const order = await found("sort=newest");
    expect(order.indexOf(id("manualA"))).toBeLessThan(order.indexOf(id("manualB")));
  });

  it("orders the map pins the same way, collected or walked", async () => {
    expect((await locationPins(crit("sort=newest"))).map((p) => p.id)).toEqual(expected());
    expect((await searchMapPins(crit("sort=newest"))).map((p) => p.id)).toEqual(expected());
  });

  it("puts the public key second in the default order too", async () => {
    expect(await found("")).toEqual(expected());
  });
});

describe("area stats", () => {
  // The stats count only public for-sale homes (areaForSale: active, coming soon), so the
  // pending rows above drop out by status. Coming soon is always hidden (the idx_hidden
  // generated column), feed or manual, so today only active rows reach getAreaStats'
  // hidesListDate() exclusions: those are a guard. Rows added only here so the search
  // tests above keep theirs.
  beforeAll(async () => {
    await insertListings(feed, [
      listing(8, { ...royston, status: "coming_soon", listDate: daysAgo(4) }),
    ]);
    await insertListings(manual, [
      listing(9, { ...royston, status: "coming_soon", listDate: daysAgo(5) }),
    ]);
    // A manual active home, public like the rows above: its list date shows, so it counts.
    const [manualActive] = await insertListings(manual, [
      listing(10, { ...royston, listDate: daysAgo(5) }),
    ]);
    await db
      .update(listings)
      .set({ publicSince: publicDaysAgo(5) })
      .where(eq(listings.id, manualActive));
  });

  it("count only public active homes: neither coming-soon row, nor any pending one", async () => {
    const area = findArea("royston")!;
    const stats = (await getAreaStats([area])).get(area.slug)!;
    // The feed active home and the manual one; both coming-soon rows are idx_hidden.
    expect(stats.forSale).toBe(2);
    expect(stats.newListings).toBe(2);
    expect(stats.listDateSample).toBe(2);
    expect(stats.daysOnMarketSample).toBe(2);
  });
});
