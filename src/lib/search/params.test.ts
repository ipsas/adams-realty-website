import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  describeCriteria,
  parseBounds,
  parseSearchParams,
  searchHref,
  serializeCriteria,
} from "./params";

describe("parseSearchParams", () => {
  it("returns defaults for an empty query", () => {
    expect(parseSearchParams({})).toEqual({ mode: "buy", sort: "recommended", page: 1 });
  });

  it("parses a full query from a Next.js searchParams object", () => {
    const c = parseSearchParams({
      q: " 78704 ",
      mode: "rent",
      minPrice: "2000",
      maxPrice: "4500",
      beds: "2",
      baths: "1.5",
      types: "condo,townhouse,castle",
      pool: "1",
      garage: "true",
      bounds: "-97.8,30.2,-97.7,30.3",
      sort: "price_asc",
      page: "3",
    });
    expect(c).toEqual({
      q: "78704",
      mode: "rent",
      minPrice: 2000,
      maxPrice: 4500,
      beds: 2,
      baths: 1.5,
      types: ["condo", "townhouse"],
      pool: true,
      garage: true,
      bounds: { west: -97.8, south: 30.2, east: -97.7, north: 30.3 },
      sort: "price_asc",
      page: 3,
    });
  });

  it("drops invalid values instead of failing", () => {
    const c = parseSearchParams(
      new URLSearchParams("mode=lease&beds=lots&sort=cheapest&page=-2&pool=yes&bounds=1,2,3"),
    );
    expect(c).toEqual({ mode: "buy", sort: "recommended", page: 1 });
  });

  it("uses the first value of repeated params", () => {
    expect(parseSearchParams({ beds: ["3", "4"] }).beds).toBe(3);
  });

  it("swaps inverted ranges", () => {
    const c = parseSearchParams({ minPrice: "900000", maxPrice: "500000" });
    expect([c.minPrice, c.maxPrice]).toEqual([500000, 900000]);
  });
});

describe("parseBounds", () => {
  it("rejects degenerate or out-of-range boxes", () => {
    expect(parseBounds("-97.7,30.3,-97.8,30.2")).toBeUndefined();
    expect(parseBounds("-200,30,-97,31")).toBeUndefined();
    expect(parseBounds("a,b,c,d")).toBeUndefined();
  });
});

describe("serializeCriteria", () => {
  it("round-trips through parse", () => {
    const original = parseSearchParams({
      q: "Travis Heights",
      beds: "3",
      types: "single_family",
      openHouse: "1",
      bounds: "-97.123456789,30.1,-97.0,30.2",
      page: "2",
    });
    const reparsed = parseSearchParams(serializeCriteria(original));
    expect(reparsed).toEqual({
      ...original,
      bounds: { west: -97.12346, south: 30.1, east: -97, north: 30.2 },
    });
  });

  it("omits defaults so URLs stay short", () => {
    expect(searchHref({ mode: "buy", sort: "recommended", page: 1 })).toBe("/homes");
    expect(searchHref({ mode: "rent", q: "Austin" })).toBe("/homes?q=Austin&mode=rent");
  });
});

describe("describeCriteria and countActiveFilters", () => {
  it("summarizes a search for saved-search names", () => {
    const c = parseSearchParams({ q: "78704", beds: "3", maxPrice: "900000" });
    expect(describeCriteria(c)).toBe("3+ bd homes in 78704 under $900K");
    expect(describeCriteria(parseSearchParams({ mode: "rent", types: "condo" }))).toBe("Condos");
  });

  it("counts filters but not location, sort or page", () => {
    const c = parseSearchParams({
      q: "Austin",
      minPrice: "1",
      maxPrice: "2",
      beds: "2",
      pool: "1",
      sort: "newest",
      page: "4",
    });
    expect(countActiveFilters(c)).toBe(3);
  });
});
