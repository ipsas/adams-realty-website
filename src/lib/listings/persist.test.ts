import { describe, expect, it } from "vitest";
import type { NormalizedListing } from "@/lib/mls/types";
import { diffEvents } from "./persist";
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
