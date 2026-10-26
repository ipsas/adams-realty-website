import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_LISTING_INDEXING,
  listingIndexingMode,
  listingRobots,
  type IndexableListing,
} from "./indexing";

describe("listingIndexingMode", () => {
  afterEach(() => vi.restoreAllMocks());

  it("defaults to area when unset or empty", () => {
    expect(DEFAULT_LISTING_INDEXING).toBe("area");
    expect(listingIndexingMode({})).toBe("area");
    expect(listingIndexingMode({ LISTINGS_INDEXING: "" })).toBe("area");
    expect(listingIndexingMode({ LISTINGS_INDEXING: "  " })).toBe("area");
  });

  it("reads none and area, in any case and with spaces", () => {
    expect(listingIndexingMode({ LISTINGS_INDEXING: "none" })).toBe("none");
    expect(listingIndexingMode({ LISTINGS_INDEXING: "area" })).toBe("area");
    expect(listingIndexingMode({ LISTINGS_INDEXING: " NONE " })).toBe("none");
    expect(listingIndexingMode({ LISTINGS_INDEXING: "Area" })).toBe("area");
  });

  it("fails safe: any other value indexes no listings, with one warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(listingIndexingMode({ LISTINGS_INDEXING: "all" })).toBe("none");
    expect(listingIndexingMode({ LISTINGS_INDEXING: "statewide" })).toBe("none");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("LISTINGS_INDEXING", "none");
    expect(listingIndexingMode()).toBe("none");
    vi.unstubAllEnvs();
  });
});

describe("listingRobots", () => {
  const listing = (over: Partial<IndexableListing> = {}): IndexableListing => ({
    city: "Royston",
    county: "Franklin",
    neighborhood: null,
    waterBodyName: null,
    status: "active",
    isCompanyListing: false,
    removedAt: null,
    ...over,
  });
  const noindex = { index: false, follow: true };
  const outOfArea = { city: "Savannah", county: "Chatham" };

  it("indexes a live listing in the firm's area, the firm's or not", () => {
    expect(listingRobots(listing(), "area")).toBeUndefined();
    expect(listingRobots(listing({ isCompanyListing: true }), "area")).toBeUndefined();
  });

  it("indexes the firm's own listing outside its area", () => {
    expect(listingRobots(listing({ ...outOfArea, isCompanyListing: true }), "area")).toBeUndefined();
  });

  it("noindexes someone else's listing outside the firm's area, but follows its links", () => {
    expect(listingRobots(listing(outOfArea), "area")).toEqual(noindex);
    // No county: it can't be placed, so it's outside.
    expect(listingRobots(listing({ county: null }), "area")).toEqual(noindex);
  });

  it("noindexes sold listings, even the firm's own in its area", () => {
    expect(listingRobots(listing({ status: "closed" }), "area")).toEqual(noindex);
    expect(listingRobots(listing({ status: "closed", isCompanyListing: true }), "area")).toEqual(
      noindex,
    );
  });

  it("noindexes removed listings", () => {
    const removed = listing({ removedAt: new Date(), isCompanyListing: true });
    expect(listingRobots(removed, "area")).toMatchObject({ index: false });
  });

  it('noindexes every listing in "none" mode', () => {
    expect(listingRobots(listing(), "none")).toEqual(noindex);
    expect(listingRobots(listing({ isCompanyListing: true }), "none")).toEqual(noindex);
  });
});
