import { describe, expect, it, vi } from "vitest";
import type { NormalizedListing } from "@/lib/mls/types";
import { diffEvents, mediaSignature, openHouseSignature, sanitizeListing } from "./persist";
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
  it("records a new listing as listed", () => {
    const events = diffEvents("id", null, listing(), now);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "listed", price: 500000, toStatus: "active" });
    expect(events[0].occurredAt).toEqual(new Date("2026-09-01T12:00:00Z"));
  });

  it("records listed + sold for a listing first seen as closed", () => {
    const events = diffEvents(
      "id",
      null,
      listing({ status: "closed", closePrice: 490000, closeDate: "2026-09-20" }),
      now,
    );
    expect(events.map((e) => e.type)).toEqual(["listed", "sold"]);
    expect(events[1].price).toBe(490000);
  });

  it("records price drops", () => {
    const events = diffEvents(
      "id",
      { listPrice: 525000, status: "active", removedAt: null },
      listing(),
      now,
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
    );
    expect(pending).toEqual([
      expect.objectContaining({ type: "status_change", fromStatus: "active", toStatus: "pending" }),
    ]);

    const sold = diffEvents(
      "id",
      { listPrice: 500000, status: "pending", removedAt: null },
      listing({ status: "closed", closePrice: 510000, listPrice: 500000 }),
      now,
    );
    expect(sold).toEqual([expect.objectContaining({ type: "sold", price: 510000 })]);
  });

  it("records nothing when nothing changed", () => {
    expect(
      diffEvents("id", { listPrice: 500000, status: "active", removedAt: null }, listing(), now),
    ).toEqual([]);
  });

  it("records a relist when a removed listing returns", () => {
    const events = diffEvents(
      "id",
      { listPrice: 500000, status: "active", removedAt: new Date() },
      listing(),
      now,
    );
    expect(events.map((e) => e.type)).toEqual(["relisted"]);
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
