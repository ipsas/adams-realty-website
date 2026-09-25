import { describe, expect, it } from "vitest";
import {
  filterListings,
  listingsHref,
  matchesAddress,
  parseListingsFilter,
} from "./listings-filter";

const row = (
  status: string,
  addressLine1: string,
  city = "Lavonia",
  unitNumber: string | null = null,
) => ({
  status,
  addressLine1,
  unitNumber,
  city,
});

const rows = [
  row("active", "12 Oak St", "Royston"),
  row("active", "400 Depot St", "Lavonia", "1204"),
  row("coming_soon", "9 Oakleaf Dr"),
  row("active_under_contract", "77 Pine Ave", "Hartwell"),
  row("pending", "5 Elm Ct", "Royston"),
  row("closed", "18 Oak Hollow Rd", "Toccoa"),
  row("withdrawn", "3 Maple Way"),
  row("expired", "4 Birch Ln"),
  row("canceled", "6 Cedar Pl"),
];

describe("parseListingsFilter", () => {
  it("accepts known tabs and tidies the query", () => {
    expect(parseListingsFilter({ status: "sold", q: "  oak   st " })).toEqual({
      status: "sold",
      q: "oak st",
    });
  });

  it("falls back to All for unknown or repeated values", () => {
    expect(parseListingsFilter({ status: "bogus" })).toEqual({ status: "", q: "" });
    expect(parseListingsFilter({ status: ["off-market", "sold"], q: ["a", "b"] })).toEqual({
      status: "off-market",
      q: "a",
    });
  });

  it("caps the query length", () => {
    expect(parseListingsFilter({ q: "x".repeat(500) }).q).toHaveLength(100);
  });
});

describe("listingsHref", () => {
  it("omits defaults", () => {
    expect(listingsHref({ status: "", q: "" })).toBe("/dashboard/listings");
    expect(listingsHref({ status: "under-contract", q: "" })).toBe(
      "/dashboard/listings?status=under-contract",
    );
    expect(listingsHref({ status: "", q: "oak & pine" })).toBe(
      "/dashboard/listings?q=oak+%26+pine",
    );
  });
});

describe("matchesAddress", () => {
  it("needs every word, in any order, across street, unit and city", () => {
    expect(matchesAddress(rows[0], "oak royston")).toBe(true);
    expect(matchesAddress(rows[0], "ROYSTON  oak")).toBe(true);
    expect(matchesAddress(rows[0], "oak hartwell")).toBe(false);
    expect(matchesAddress(rows[1], "depot #1204")).toBe(true);
    expect(matchesAddress(rows[1], "")).toBe(true);
  });
});

describe("filterListings", () => {
  it("groups statuses into tabs and counts each", () => {
    const { rows: shown, counts } = filterListings(rows, { status: "", q: "" });
    expect(shown).toHaveLength(rows.length);
    expect(counts).toEqual({
      "": 9,
      active: 2,
      "coming-soon": 1,
      "under-contract": 2,
      sold: 1,
      "off-market": 3,
    });
  });

  it("filters by tab", () => {
    const { rows: shown } = filterListings(rows, { status: "under-contract", q: "" });
    expect(shown.map((r) => r.status)).toEqual(["active_under_contract", "pending"]);
    expect(filterListings(rows, { status: "off-market", q: "" }).rows).toHaveLength(3);
  });

  it("counts reflect the address search", () => {
    const { rows: shown, counts } = filterListings(rows, { status: "", q: "oak" });
    expect(shown.map((r) => r.addressLine1)).toEqual([
      "12 Oak St",
      "9 Oakleaf Dr",
      "18 Oak Hollow Rd",
    ]);
    expect(counts).toMatchObject({ "": 3, active: 1, "coming-soon": 1, sold: 1, "off-market": 0 });
  });

  it("combines tab and search", () => {
    const { rows: shown } = filterListings(rows, { status: "sold", q: "oak" });
    expect(shown.map((r) => r.addressLine1)).toEqual(["18 Oak Hollow Rd"]);
  });
});
