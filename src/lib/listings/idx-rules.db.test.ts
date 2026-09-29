import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { findSearchMatches } from "@/lib/alerts/queries";
import type { Actor } from "@/lib/auth/permissions";
import { getDashboardListings } from "@/lib/dashboard/queries";
import { mapResoProperty, type ResoProperty } from "@/lib/mls/reso/mapper";
import type { NormalizedListing, NormalizedMedia } from "@/lib/mls/types";
import { parseSearchParams } from "@/lib/search/params";
import { searchListings, searchMapPins } from "@/lib/search/service";
import { closeDb, createSource, listing, persistSource, resetDb } from "@/test/db/helpers";
import { selectCards, withPhotos } from "./card";
import { upsertListing, upsertListings } from "./persist";
import { refreshPlaces } from "./places";
import {
  getListingBySlug,
  getLocationSuggestions,
  getMarketStats,
  getNewestListings,
  getPlacesIndex,
  getTopCities,
} from "./queries";
import { getListingSitemapChunk } from "./sitemap-query";
import { IDX_HIDDEN_STATUSES, isIdxHidden } from "./visibility";

// Georgia MLS IDX display rules on real queries, with feed rows ("fixtures")
// in every status next to the firm's own manual listings in the same statuses:
// hidden statuses stay off every public surface for both (the firm hides its
// own the same way), sold feed listings carry one photo, and the dashboard
// still shows staff every one of the firm's listings.

const STATUSES = listings.status.enumValues;
type Status = (typeof STATUSES)[number];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function photos(key: number): NormalizedMedia[] {
  return [0, 1, 2].map((i) => ({
    sourceKey: `m${key}-${i}`,
    url: `https://photos.example.com/${key}/${i}.jpg`,
    kind: "photo" as const,
    caption: null,
    width: null,
    height: null,
    sortOrder: i,
  }));
}

function inStatus(key: number, status: Status, over: Partial<NormalizedListing> = {}) {
  return listing(key, {
    status,
    city: "Ruleton",
    county: "Clarke",
    latitude: 33.9 + key / 10_000,
    longitude: -83.4,
    listDate: daysAgo(5),
    closeDate: status === "closed" ? daysAgo(10) : null,
    closePrice: status === "closed" ? 290_000 + key : null,
    media: photos(key),
    ...over,
  });
}

/** "feed:status" / "manual:status" for each row id. */
const labels = new Map<string, string>();
const idOf = (label: string) => [...labels].find(([, l]) => l === label)![0];
const slugOf = async (label: string) =>
  (
    await db
      .select({ slug: listings.slug })
      .from(listings)
      .where(eq(listings.id, idOf(label)))
  )[0].slug;
const labelled = (ids: string[]) =>
  ids
    .map((id) => labels.get(id))
    .filter(Boolean)
    .sort();

let feed: Awaited<ReturnType<typeof createSource>>;
let manual: Awaited<ReturnType<typeof createSource>>;

beforeAll(async () => {
  await resetDb();
  feed = await createSource();
  manual = await createSource({ slug: "adams", name: "Adams Realty", kind: "manual", config: {} });
  for (const [k, status] of STATUSES.entries()) {
    const [f] = await upsertListings(db, persistSource(feed), [inStatus(k + 1, status)]);
    labels.set(f.id, `feed:${status}`);
    const m = await db.transaction((tx) =>
      upsertListing(tx, persistSource(manual), inStatus(k + 50, status)),
    );
    labels.set(m.id, `manual:${status}`);
  }
  await refreshPlaces(db);
});

afterAll(closeDb);

const PUBLIC_LIVE = [
  "feed:active",
  "feed:active_under_contract",
  "feed:pending",
  "manual:active",
  "manual:active_under_contract",
  "manual:pending",
];
const HIDDEN = [...IDX_HIDDEN_STATUSES];

describe("the idx_hidden column", () => {
  it("marks exactly the rows in a hidden status, feed and manual alike", async () => {
    const rows = await db
      .select({
        id: listings.id,
        fromFeed: listings.fromFeed,
        status: listings.status,
        idxHidden: listings.idxHidden,
      })
      .from(listings);
    expect(rows).toHaveLength(STATUSES.length * 2);
    for (const r of rows) {
      expect(r.fromFeed, labels.get(r.id)).toBe(labels.get(r.id)!.startsWith("feed:"));
      expect(r.idxHidden, labels.get(r.id)).toBe(isIdxHidden(r));
    }
    expect(
      rows
        .filter((r) => r.idxHidden)
        .map((r) => labels.get(r.id))
        .sort(),
    ).toEqual([
      "feed:canceled",
      "feed:coming_soon",
      "feed:expired",
      "feed:withdrawn",
      "manual:canceled",
      "manual:coming_soon",
      "manual:expired",
      "manual:withdrawn",
    ]);
  });
});

describe("hidden listings stay off every public surface, the firm's own included", () => {
  it("search, in every mode", async () => {
    const ids = async (q: Record<string, string>) =>
      labelled(
        (await searchListings(parseSearchParams({ q: "Ruleton", ...q }))).items.map((i) => i.id),
      );
    expect(await ids({})).toEqual(["feed:active", "manual:active"]);
    expect(await ids({ pending: "1" })).toEqual(PUBLIC_LIVE);
    expect(await ids({ mode: "sold" })).toEqual(["feed:closed", "manual:closed"]);
  });

  it("the map's pins", async () => {
    const pins = await searchMapPins(parseSearchParams({ q: "Ruleton", pending: "1" }));
    expect(labelled(pins.map((p) => p.id))).toEqual(PUBLIC_LIVE);
  });

  it("the listing sitemap", async () => {
    const slugs = new Set((await getListingSitemapChunk(0, 1000)).map((r) => r.slug));
    for (const label of labels.values()) {
      const shown = PUBLIC_LIVE.includes(label);
      expect(slugs.has(await slugOf(label)), label).toBe(shown);
    }
  });

  it("the home page's newest homes, town chips, places index and stats", async () => {
    expect(labelled((await getNewestListings(50)).map((l) => l.id))).toEqual([
      "feed:active",
      "manual:active",
    ]);
    expect(await getTopCities()).toEqual([{ city: "Ruleton", count: 2 }]);
    expect(await getPlacesIndex()).toEqual([
      { county: "Clarke", cities: [{ city: "Ruleton", count: 2 }] },
    ]);
    expect((await getMarketStats()).active).toBe(2);
  });

  it("location autocomplete counts", async () => {
    const [city] = (await getLocationSuggestions("Rulet")).filter((s) => s.kind === "city");
    expect(city.count).toBe(PUBLIC_LIVE.length);
  });

  it("listing pages", async () => {
    for (const status of HIDDEN) {
      expect(await getListingBySlug(await slugOf(`feed:${status}`)), status).toBeNull();
      expect(await getListingBySlug(await slugOf(`manual:${status}`)), status).toBeNull();
    }
    for (const label of [...PUBLIC_LIVE, "feed:closed", "manual:closed"]) {
      expect(await getListingBySlug(await slugOf(label)), label).not.toBeNull();
    }
  });

  it("saved-search alerts announce only the listings the public can see", async () => {
    // Every row was written moments ago; a window around now covers them all.
    const now = new Date();
    const win = { start: new Date(now.getTime() - 3_600_000), end: now };
    const matches = await findSearchMatches(
      db,
      parseSearchParams({ q: "Ruleton", pending: "1" }),
      { listings: win, events: win },
      now,
    );
    expect(labelled(matches.newRows.map((r) => r.id))).toEqual(PUBLIC_LIVE);
  });

  it("a feed listing that left the feed has no page; the firm's own keeps one", async () => {
    await db
      .update(listings)
      .set({ removedAt: new Date() })
      .where(inArray(listings.id, [idOf("feed:pending"), idOf("manual:pending")]));
    try {
      expect(await getListingBySlug(await slugOf("feed:pending"))).toBeNull();
      expect(await getListingBySlug(await slugOf("manual:pending"))).not.toBeNull();
    } finally {
      await db
        .update(listings)
        .set({ removedAt: null })
        .where(inArray(listings.id, [idOf("feed:pending"), idOf("manual:pending")]));
    }
  });
});

describe("photos", () => {
  it("a sold feed listing's page has its primary photo only; live ones have all", async () => {
    const sold = await getListingBySlug(await slugOf("feed:closed"));
    expect(sold!.media.map((m) => m.url)).toEqual(["https://photos.example.com/5/0.jpg"]);
    const pending = await getListingBySlug(await slugOf("feed:pending"));
    expect(pending!.media).toHaveLength(3);
    const manualSold = await getListingBySlug(await slugOf("manual:closed"));
    expect(manualSold!.media).toHaveLength(3);
  });

  it("cards: one photo for sold feed homes, none for hidden ones (a saved home), all otherwise", async () => {
    const rows = await selectCards(db).where(inArray(listings.id, [...labels.keys()]));
    const cards = await withPhotos(db, rows);
    const count = new Map(cards.map((c) => [labels.get(c.id)!, c.photos.length]));
    expect(count.get("feed:closed")).toBe(1);
    expect(count.get("feed:active_under_contract")).toBe(3);
    expect(count.get("feed:active")).toBe(3);
    for (const status of HIDDEN) {
      expect(count.get(`feed:${status}`), status).toBe(0);
      expect(count.get(`manual:${status}`), status).toBe(0);
    }
    expect(count.get("manual:closed")).toBe(3);
  });
});

describe("the dashboard", () => {
  it("still lists every one of the firm's listings, hidden ones with their status", async () => {
    const admin: Actor = { userId: "u-admin", role: "admin", agentId: null };
    const rows = (await getDashboardListings(admin)).filter((r) => labels.has(r.id));
    // Admins manage the company's listings: every manual row, whatever its status.
    expect(rows.map((r) => labels.get(r.id)).sort()).toEqual(
      STATUSES.map((s) => `manual:${s}`).sort(),
    );
    for (const status of HIDDEN) {
      const row = rows.find((r) => labels.get(r.id) === `manual:${status}`)!;
      expect(row.status, status).toBe(status);
    }
  });
});

describe("saved-search alerts", () => {
  it("announce a Coming Soon feed listing as new when it goes active, not before", async () => {
    const key = 900;
    const soon = inStatus(key, "coming_soon", { listDate: null, city: "Alertville" });
    const [row] = await upsertListings(db, persistSource(feed), [soon]);
    const [{ publicSince }] = await db
      .select({ publicSince: listings.publicSince })
      .from(listings)
      .where(eq(listings.id, row.id));
    expect(publicSince).toBeNull();

    const goesLive = new Date(Date.now() + 3_600_000);
    await upsertListings(
      db,
      persistSource(feed),
      [{ ...soon, status: "active", sourceModifiedAt: goesLive }],
      { now: goesLive },
    );
    const win = {
      start: new Date(goesLive.getTime() - 60_000),
      end: new Date(goesLive.getTime() + 60_000),
    };
    const matches = await findSearchMatches(
      db,
      parseSearchParams({ q: "Alertville" }),
      { listings: win, events: win },
      goesLive,
    );
    expect(matches.newRows.map((r) => r.id)).toEqual([row.id]);
    // A later window doesn't announce it again.
    const later = { start: win.end, end: new Date(win.end.getTime() + 86_400_000) };
    const again = await findSearchMatches(
      db,
      parseSearchParams({ q: "Alertville" }),
      { listings: later, events: later },
      later.end,
    );
    expect(again.newRows).toEqual([]);
  });
});

describe("saved-search alerts for the firm's own listings", () => {
  it("announce a manual Coming Soon listing as new when it goes active, not before", async () => {
    const soon = inStatus(901, "coming_soon", { listDate: null, city: "Firmville" });
    const row = await db.transaction((tx) => upsertListing(tx, persistSource(manual), soon));
    const publicSince = async () =>
      (
        await db
          .select({ publicSince: listings.publicSince })
          .from(listings)
          .where(eq(listings.id, row.id))
      )[0].publicSince;
    expect(await publicSince()).toBeNull();

    const before = new Date();
    const hiddenWin = { start: new Date(before.getTime() - 60_000), end: before };
    const whileHidden = await findSearchMatches(
      db,
      parseSearchParams({ q: "Firmville" }),
      { listings: hiddenWin, events: hiddenWin },
      before,
    );
    expect(whileHidden.newRows).toEqual([]);

    const goesLive = new Date(Date.now() + 7_200_000);
    await db.transaction((tx) =>
      upsertListing(
        tx,
        persistSource(manual),
        { ...soon, status: "active", sourceModifiedAt: goesLive },
        { now: goesLive },
      ),
    );
    expect(await publicSince()).toEqual(goesLive);
    const win = {
      start: new Date(goesLive.getTime() - 60_000),
      end: new Date(goesLive.getTime() + 60_000),
    };
    const matches = await findSearchMatches(
      db,
      parseSearchParams({ q: "Firmville" }),
      { listings: win, events: win },
      goesLive,
    );
    expect(matches.newRows.map((r) => r.id)).toEqual([row.id]);
  });
});

describe("unbiased sort (IDX agreement §12)", () => {
  it("a featured Adams listing leads the default order, and nothing else", async () => {
    const featured = await db.transaction((tx) =>
      upsertListing(
        tx,
        persistSource(manual),
        listing(700, {
          city: "Sortville",
          listPrice: 650_000,
          listDate: daysAgo(40),
          livingAreaSqft: 1500,
        }),
        { isFeatured: true },
      ),
    );
    await upsertListings(db, persistSource(feed), [
      listing(701, {
        city: "Sortville",
        listPrice: 250_000,
        listDate: daysAgo(2),
        livingAreaSqft: 2600,
      }),
      listing(702, {
        city: "Sortville",
        listPrice: 450_000,
        listDate: daysAgo(9),
        livingAreaSqft: 2000,
      }),
    ]);
    const order = async (sort: string) =>
      (await searchListings(parseSearchParams({ q: "Sortville", sort }))).items.map(
        (i) => i.listPrice,
      );
    expect(await order("recommended")).toEqual([650_000, 250_000, 450_000]);
    expect(await order("price_asc")).toEqual([250_000, 450_000, 650_000]);
    expect(await order("price_desc")).toEqual([650_000, 450_000, 250_000]);
    expect(await order("newest")).toEqual([250_000, 450_000, 650_000]);
    expect(await order("sqft_desc")).toEqual([250_000, 450_000, 650_000]);
    expect(await order("price_per_sqft_asc")).toEqual([250_000, 450_000, 650_000]);
    const [row] = await db.select().from(listings).where(eq(listings.id, featured.id));
    expect(row.isFeatured && row.isCompanyListing).toBe(true);
  });
});

describe("fields Georgia MLS forbids (Exhibit C)", () => {
  it("never reach the database from a feed record", async () => {
    const SENTINEL = "EXCLUDED-9c1d";
    const record: ResoProperty = {
      ListingKey: "RESO-EXCL-1",
      ListingId: "10999001",
      StandardStatus: "Active",
      PropertyType: "Residential",
      ListPrice: 333_333,
      StreetNumber: "1",
      StreetName: "Exclusion",
      StreetSuffix: "Way",
      City: "Ruleton",
      StateOrProvince: "GA",
      PostalCode: "30601",
      CountyOrParish: "Clarke",
      ModificationTimestamp: "2026-09-20T15:30:00Z",
      ListingAgreement: `Exclusive ${SENTINEL}`,
      ListingContractDate: "2026-01-02",
      OnMarketDate: "2026-01-03",
      ExpirationDate: "2026-12-31",
      PrivateRemarks: `Private ${SENTINEL}`,
      ShowingContactName: `Shower ${SENTINEL}`,
      ShowingContactPhone: "(404) 555-0177",
      OfficeRemarks: `Office ${SENTINEL}`,
      PrivateOfficeRemarks: `Office ${SENTINEL}`,
      ShowingRequirements: `Call ${SENTINEL}`,
      ShowingInstructions: `Call ${SENTINEL}`,
      AttributionContact: "Listing office (706) 555-0123 office@example.com",
      DualVariableCompensationYN: false,
    };
    const mapped = mapResoProperty(record);
    if (!mapped.ok) throw new Error(mapped.reason);
    await upsertListings(db, persistSource(feed), [mapped.listing]);
    const [{ row }] = (
      await db.execute<{ row: Record<string, unknown> }>(
        sql`select to_jsonb(l) as row from listings l where listing_key = 'RESO-EXCL-1'`,
      )
    ).rows;
    const json = JSON.stringify(row);
    for (const forbidden of [SENTINEL, "555-0177", "2026-01-02", "2026-01-03", "2026-12-31"]) {
      expect(json).not.toContain(forbidden);
    }
    // The mandatory attribution fields did arrive.
    expect(row).toMatchObject({
      attribution_phone: "(706) 555-0123",
      attribution_email: "office@example.com",
      variable_compensation: false,
    });
  });
});
