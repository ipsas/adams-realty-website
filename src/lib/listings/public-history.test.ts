import { describe, expect, it } from "vitest";
import type { listingEvents } from "@/db/schema";
import { publicHistory } from "./public-history";

type ListingEvent = typeof listingEvents.$inferSelect;

const event = (
  id: string,
  type: ListingEvent["type"],
  occurredAt: string,
  over: Partial<ListingEvent> = {},
): ListingEvent => ({
  id,
  listingId: "listing",
  type,
  occurredAt: new Date(occurredAt),
  price: 500_000,
  previousPrice: null,
  fromStatus: null,
  toStatus: null,
  ...over,
});

// Newest first, as getListingBySlug selects them. An older feed row: listed (dated by the
// list date back then) after the sale it was first seen with.
const inverted = [
  event("listed", "listed", "2026-10-20T12:00:00Z", { toStatus: "active" }),
  event("sold", "sold", "2026-10-17T12:00:00Z", { toStatus: "closed", price: 490_000 }),
  event("cut", "price_change", "2026-10-10T12:00:00Z", { previousPrice: 510_000 }),
];

describe("publicHistory", () => {
  it("strips a feed listing's event dates, keeping what the table shows", () => {
    const out = publicHistory(inverted, true);
    for (const e of out) {
      expect(Object.keys(e).sort()).toEqual(
        ["fromStatus", "id", "previousPrice", "price", "toStatus", "type"].sort(),
      );
    }
    const json = JSON.stringify(out);
    expect(json).not.toContain("occurredAt");
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(out.find((e) => e.id === "cut")).toMatchObject({
      type: "price_change",
      price: 500_000,
      previousPrice: 510_000,
    });
  });

  it("puts a feed listing's first listed event last, the rest newest first", () => {
    expect(publicHistory(inverted, true).map((e) => e.id)).toEqual(["sold", "cut", "listed"]);
    // A relist keeps its place.
    const relisted = [
      event("removed", "removed", "2026-10-21T12:00:00Z"),
      event("listed", "listed", "2026-10-01T12:00:00Z"),
      event("relisted", "relisted", "2026-10-25T12:00:00Z"),
    ];
    expect(publicHistory(relisted, true).map((e) => e.id)).toEqual([
      "relisted",
      "removed",
      "listed",
    ]);
  });

  it("leaves a manual listing's history as it is, dates included", () => {
    expect(publicHistory(inverted, false)).toEqual(inverted);
  });

  it("handles an empty history", () => {
    expect(publicHistory([], true)).toEqual([]);
  });
});
