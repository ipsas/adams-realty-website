import { describe, expect, it } from "vitest";
import {
  allocateRows,
  priceCutDetails,
  summarizeHomeEvents,
  toEmailListing,
  type AlertListing,
  type HomeEvent,
} from "./present";

const listing: AlertListing = {
  id: "l1",
  slug: "123-oak-st-decatur-ga-abc123",
  status: "active",
  transactionType: "sale",
  listPrice: 485_000,
  closePrice: null,
  bedrooms: 3,
  bathrooms: 2.5,
  livingAreaSqft: 1850,
  addressLine1: "123 Oak St",
  unitNumber: null,
  city: "Decatur",
  state: "GA",
  postalCode: "30030",
  hideAddress: false,
  primaryPhotoUrl: null,
  listOfficeName: "Peachtree Partners",
  isCompanyListing: false,
};

const ev = (e: Partial<HomeEvent> & Pick<HomeEvent, "type" | "occurredAt">): HomeEvent => ({
  price: null,
  previousPrice: null,
  fromStatus: null,
  toStatus: null,
  ...e,
});
const t = (h: number) => new Date(Date.UTC(2026, 8, 25, h));

describe("toEmailListing", () => {
  it("maps a listing to an email row with attribution and an absolute link", () => {
    const row = toEmailListing(listing);
    expect(row.href).toMatch(/^https?:\/\/.+\/homes\/123-oak-st-decatur-ga-abc123$/);
    expect(row).toMatchObject({
      price: 485_000,
      street: "123 Oak St",
      cityLine: "Decatur, GA 30030",
      attribution: "Listed by Peachtree Partners",
    });
    expect(row.priceSuffix).toBeUndefined();
  });

  it("respects suppressed addresses, rentals and sold prices", () => {
    expect(toEmailListing({ ...listing, hideAddress: true }).street).toBe(
      "Address withheld by seller",
    );
    expect(toEmailListing({ ...listing, transactionType: "rent" }).priceSuffix).toBe("/mo");
    expect(toEmailListing({ ...listing, status: "closed", closePrice: 470_000 }).price).toBe(
      470_000,
    );
  });
});

describe("priceCutDetails", () => {
  it("describes a real drop and ignores anything else", () => {
    expect(priceCutDetails(500_000, listing)).toEqual({
      badge: { label: "Price cut $15,000", tone: "clay" },
      notes: ["Was $500,000"],
    });
    expect(priceCutDetails(null, listing)).toEqual({});
    expect(priceCutDetails(485_000, listing)).toEqual({});
    expect(priceCutDetails(2_600, { listPrice: 2_400, transactionType: "rent" })).toEqual({
      badge: { label: "Rent drop $200", tone: "clay" },
      notes: ["Was $2,600/mo"],
    });
  });
});

describe("allocateRows", () => {
  it("fills with new listings but keeps room for price cuts", () => {
    expect(allocateRows(10, 5)).toEqual({ newShown: 7, cutsShown: 3 });
    expect(allocateRows(2, 12)).toEqual({ newShown: 2, cutsShown: 8 });
    expect(allocateRows(10, 0)).toEqual({ newShown: 10, cutsShown: 0 });
    expect(allocateRows(5, 1)).toEqual({ newShown: 5, cutsShown: 1 });
    expect(allocateRows(0, 20)).toEqual({ newShown: 0, cutsShown: 10 });
    expect(allocateRows(0, 0)).toEqual({ newShown: 0, cutsShown: 0 });
  });
});

describe("summarizeHomeEvents", () => {
  it("reports a net price cut", () => {
    const events = [
      ev({ type: "price_change", occurredAt: t(9), price: 490_000, previousPrice: 500_000 }),
      ev({ type: "price_change", occurredAt: t(10), price: 485_000, previousPrice: 490_000 }),
    ];
    expect(summarizeHomeEvents(events, listing)).toEqual({
      badge: { label: "Price cut $15,000", tone: "clay" },
      notes: ["Now $485,000, was $500,000"],
    });
  });

  it("leads with a status change and still mentions the price", () => {
    const events = [
      ev({ type: "price_change", occurredAt: t(9), price: 485_000, previousPrice: 500_000 }),
      ev({ type: "status_change", occurredAt: t(10), fromStatus: "active", toStatus: "pending" }),
    ];
    expect(summarizeHomeEvents(events, listing)).toEqual({
      badge: { label: "Pending", tone: "brass" },
      notes: ["Now pending (was for sale)", "Price cut $15,000 — now $485,000"],
    });
  });

  it("calls a return to active 'back on market'", () => {
    const back = summarizeHomeEvents(
      [ev({ type: "status_change", occurredAt: t(9), fromStatus: "pending", toStatus: "active" })],
      listing,
    );
    expect(back?.badge).toEqual({ label: "Back on market", tone: "brand" });
    const relisted = summarizeHomeEvents(
      [ev({ type: "relisted", occurredAt: t(9), price: 485_000, toStatus: "active" })],
      listing,
    );
    expect(relisted).toEqual({
      badge: { label: "Back on market", tone: "brand" },
      notes: ["Back on the market at $485,000"],
    });
  });

  it("lets a sale outrank everything else", () => {
    const events = [
      ev({ type: "price_change", occurredAt: t(8), price: 485_000, previousPrice: 500_000 }),
      ev({
        type: "sold",
        occurredAt: t(9),
        price: 480_000,
        fromStatus: "pending",
        toStatus: "closed",
      }),
    ];
    expect(summarizeHomeEvents(events, listing)).toEqual({
      badge: { label: "Sold", tone: "ink" },
      notes: ["Sold for $480,000"],
    });
  });

  it("drops changes that cancel out", () => {
    const events = [
      ev({ type: "status_change", occurredAt: t(8), fromStatus: "active", toStatus: "pending" }),
      ev({ type: "status_change", occurredAt: t(9), fromStatus: "pending", toStatus: "active" }),
      ev({ type: "price_change", occurredAt: t(10), price: 480_000, previousPrice: 485_000 }),
      ev({ type: "price_change", occurredAt: t(11), price: 485_000, previousPrice: 480_000 }),
    ];
    expect(summarizeHomeEvents(events, listing)).toBeNull();
  });

  it("orders events by time before summarizing", () => {
    const events = [
      ev({ type: "price_change", occurredAt: t(11), price: 510_000, previousPrice: 505_000 }),
      ev({ type: "price_change", occurredAt: t(10), price: 505_000, previousPrice: 500_000 }),
    ];
    expect(summarizeHomeEvents(events, listing)).toEqual({
      badge: { label: "Price increased", tone: "brass" },
      notes: ["Price increased to $510,000 (was $500,000)"],
    });
  });
});
