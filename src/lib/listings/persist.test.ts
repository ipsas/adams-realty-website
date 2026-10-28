import { afterEach, describe, expect, it, vi } from "vitest";
import { marketToday } from "@/lib/areas/stats";
import page1 from "@/lib/mls/reso/fixtures/bridge-gamls-page1.json";
import { mapResoProperty, type ResoProperty } from "@/lib/mls/reso/mapper";
import type { NormalizedListing } from "@/lib/mls/types";
import { diffEvents, mediaSignature, openHouseSignature, sanitizeListing } from "./persist";
import { publicHistory } from "./public-history";
import { listingSlug, shortHash } from "./slug";

const now = new Date("2026-09-25T12:00:00Z");

function listing(overrides: Partial<NormalizedListing> = {}): NormalizedListing {
  return {
    listingKey: "k1",
    status: "active",
    propertyType: "single_family",
    listPrice: 500000,
    addressLine1: "1 Main St",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    listDate: "2026-09-01",
    listAgentMlsId: null,
    media: [],
    openHouses: [],
    ...overrides,
  };
}

describe("diffEvents", () => {
  it("records a new manual listing as listed on its staff-entered list date", () => {
    const events = diffEvents("id", null, listing(), now, false);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "listed", price: 500000, toStatus: "active" });
    expect(events[0].occurredAt).toEqual(new Date("2026-09-01T12:00:00Z"));
  });

  it("dates a new feed listing by the sync, never by its list date or a feed timestamp", () => {
    const [listed] = diffEvents(
      "id",
      null,
      listing({
        sourceModifiedAt: new Date("2026-09-24T15:30:00Z"),
        statusChangedAt: new Date("2026-09-02T15:30:00Z"),
      }),
      now,
      true,
    );
    expect(listed).toMatchObject({ type: "listed", occurredAt: now });
  });

  it("records listed + sold for a listing first seen as closed, listed no later than sold", () => {
    const events = diffEvents(
      "id",
      null,
      listing({
        status: "closed",
        closePrice: 490000,
        closeDate: "2026-09-20",
        statusChangedAt: new Date("2026-09-22T12:00:00Z"),
      }),
      now,
      true,
    );
    expect(events.map((e) => e.type)).toEqual(["listed", "sold"]);
    expect(events[1].price).toBe(490000);
    expect(events[1].occurredAt).toEqual(new Date("2026-09-20T12:00:00Z"));
    expect(events[0].occurredAt!.getTime()).toBeLessThanOrEqual(events[1].occurredAt!.getTime());
  });

  it("keeps a manual listing first seen as closed listed on its staff date", () => {
    const events = diffEvents(
      "id",
      null,
      listing({ status: "closed", closePrice: 490000, closeDate: "2026-09-20" }),
      now,
      false,
    );
    expect(events.map((e) => e.occurredAt)).toEqual([
      new Date("2026-09-01T12:00:00Z"),
      new Date("2026-09-20T12:00:00Z"),
    ]);
  });

  it("records price drops", () => {
    const events = diffEvents(
      "id",
      { listPrice: 525000, status: "active", removedAt: null },
      listing(),
      now,
      true,
    );
    expect(events).toEqual([
      expect.objectContaining({ type: "price_change", price: 500000, previousPrice: 525000 }),
    ]);
  });

  it("records status changes and sales", () => {
    const pending = diffEvents(
      "id",
      { listPrice: 500000, status: "active", removedAt: null },
      listing({ status: "pending" }),
      now,
      true,
    );
    expect(pending).toEqual([
      expect.objectContaining({ type: "status_change", fromStatus: "active", toStatus: "pending" }),
    ]);

    const sold = diffEvents(
      "id",
      { listPrice: 500000, status: "pending", removedAt: null },
      listing({ status: "closed", closePrice: 510000, listPrice: 500000 }),
      now,
      true,
    );
    expect(sold).toEqual([expect.objectContaining({ type: "sold", price: 510000 })]);
  });

  it("records nothing when nothing changed", () => {
    expect(
      diffEvents(
        "id",
        { listPrice: 500000, status: "active", removedAt: null },
        listing(),
        now,
        true,
      ),
    ).toEqual([]);
  });

  it("records a relist when a removed listing returns", () => {
    const events = diffEvents(
      "id",
      { listPrice: 500000, status: "active", removedAt: new Date() },
      listing(),
      now,
      true,
    );
    expect(events.map((e) => e.type)).toEqual(["relisted"]);
  });
});

// Georgia MLS Exhibit C: the list date the mapper derives from DaysOnMarket stays internal.
// Bridge fixtures through the mapper (v5) and diffEvents, in time zones either side of the
// market's: neither the stored "listed" event nor the public history carries it.
describe("a feed listing's history from Bridge fixtures", () => {
  const records = (page1 as { value: unknown[] }).value as ResoProperty[];
  const mapped = (key: string) => {
    const r = mapResoProperty(records.find((p) => p.ListingKey === key)!);
    if (!r.ok) throw new Error(`${key} was skipped: ${r.reason}`);
    return r.listing;
  };
  const syncedAt = new Date("2026-10-28T15:00:00Z");
  const tz = process.env.TZ;
  afterEach(() => {
    if (tz === undefined) delete process.env.TZ;
    else process.env.TZ = tz;
  });
  /** The rows diffEvents would insert, as the database hands them back. */
  const stored = (n: NormalizedListing) =>
    diffEvents("listing", null, n, syncedAt, true).map((e, i) => ({
      id: `event-${i}`,
      listingId: e.listingId,
      type: e.type,
      occurredAt: e.occurredAt as Date,
      price: e.price ?? null,
      previousPrice: e.previousPrice ?? null,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
    }));

  for (const zone of ["UTC", "Pacific/Kiritimati", "America/Los_Angeles"]) {
    for (const key of ["GA-ADAM-0001", "GA-0002-LAND", "GA-0003-COMM", "GA-0004-FARM"]) {
      it(`${key} under TZ=${zone}`, () => {
        process.env.TZ = zone;
        const n = mapped(key);
        expect(n.listDate, "the mapper derives a list date").toMatch(/^\d{4}-\d{2}-\d{2}$/);
        const history = stored(n);
        expect(history[0].type).toBe("listed");
        expect(history[0].occurredAt).toEqual(syncedAt);
        expect(marketToday(history[0].occurredAt)).not.toBe(n.listDate);

        const json = JSON.stringify(publicHistory(history, true));
        expect(json).not.toContain(n.listDate!);
        expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/);
        for (const field of ["occurredAt", "listDate", "list_date", "datePosted"]) {
          expect(json).not.toContain(field);
        }
      });
    }
  }

  it("GA-0005-SOLD, first seen closed, is listed no later than sold", () => {
    const history = stored(mapped("GA-0005-SOLD"));
    expect(history.map((e) => e.type)).toEqual(["listed", "sold"]);
    expect(history[0].occurredAt.getTime()).toBeLessThanOrEqual(history[1].occurredAt.getTime());
    expect(publicHistory(history, true).map((e) => e.type)).toEqual(["sold", "listed"]);
  });
});

describe("listingSlug", () => {
  it("builds readable, unique slugs", () => {
    const slug = listingSlug({
      addressLine1: "1204 Travis Heights Blvd",
      unitNumber: "3B",
      city: "Austin",
      state: "TX",
      postalCode: "78704",
      sourceSlug: "actris",
      listingKey: "abc",
    });
    expect(slug).toBe(
      `1204-travis-heights-blvd-unit-3b-austin-tx-78704-${shortHash("actris:abc")}`,
    );
  });

  it("omits the street when the address is suppressed", () => {
    const slug = listingSlug({
      addressLine1: "1204 Travis Heights Blvd",
      city: "Austin",
      state: "TX",
      postalCode: "78704",
      hideAddress: true,
      sourceSlug: "actris",
      listingKey: "abc",
    });
    expect(slug.startsWith("austin-tx-78704-")).toBe(true);
  });
});

describe("mediaSignature / openHouseSignature", () => {
  const photo = (i: number, over = {}) => ({
    sourceKey: `m${i}`,
    url: `https://cdn.example.com/${i}.jpg`,
    kind: "photo" as const,
    caption: null,
    width: 1024,
    height: 768,
    sortOrder: i,
    ...over,
  });

  it("matches stored rows (any row order) against the same feed list", () => {
    const feed = [photo(0), photo(1), photo(2)];
    const stored = [photo(2), photo(0), photo(1)];
    expect(mediaSignature(stored)).toBe(mediaSignature(feed));
  });

  it("changes when a photo, its order or its caption changes", () => {
    const base = mediaSignature([photo(0), photo(1)]);
    expect(
      mediaSignature([photo(0), photo(1, { url: "https://cdn.example.com/new.jpg" })]),
    ).not.toBe(base);
    expect(mediaSignature([photo(0, { sortOrder: 1 }), photo(1, { sortOrder: 0 })])).not.toBe(base);
    expect(mediaSignature([photo(0), photo(1, { caption: "Kitchen" })])).not.toBe(base);
    expect(mediaSignature([photo(0)])).not.toBe(base);
  });

  it("compares open houses by content, in any order", () => {
    const a = {
      sourceKey: "oh1",
      type: "in_person" as const,
      startsAt: new Date("2026-10-03T17:00:00Z"),
      endsAt: new Date("2026-10-03T19:00:00Z"),
      remarks: null,
    };
    const b = { ...a, sourceKey: "oh2", startsAt: new Date("2026-10-04T17:00:00Z") };
    expect(openHouseSignature([b, a])).toBe(openHouseSignature([a, b]));
    expect(openHouseSignature([a, { ...b, endsAt: new Date("2026-10-04T20:00:00Z") }])).not.toBe(
      openHouseSignature([a, b]),
    );
  });
});

describe("sanitizeListing", () => {
  it("counts the values it nulls, in the listing and its media", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const photo = {
      sourceKey: null,
      url: "https://x/1.jpg",
      kind: "photo" as const,
      caption: null,
      width: -640,
      height: 480,
      sortOrder: 0,
    };
    const { listing: out, nulled } = sanitizeListing(
      listing({ lotSizeSqft: 2_182_094_640, latitude: 91, media: [photo] }),
    );
    expect(nulled).toBe(3);
    expect(out).toMatchObject({ lotSizeSqft: null, latitude: null, listPrice: 500000 });
    expect(out.media[0]).toMatchObject({ width: null, height: 480 });
    expect(warn).toHaveBeenCalledTimes(3);
    expect(sanitizeListing(listing()).nulled).toBe(0);
    warn.mockRestore();
  });

  it("stores the state canonically", () => {
    expect(sanitizeListing(listing({ state: " Georgia " })).listing.state).toBe("GA");
    expect(sanitizeListing(listing({ state: "al" })).listing.state).toBe("AL");
  });

  it("passes a missing state through, for the NOT NULL column to reject", () => {
    const missing = listing({ state: null as unknown as string });
    expect(sanitizeListing(missing).listing.state).toBeNull();
  });
});
