import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  describeCriteria,
  parseBounds,
  parseSearchParams,
  parseViewParam,
  propertyTypeLabel,
  searchHref,
  serializeCriteria,
  setViewParam,
  SORT_HELP,
  SORT_LABELS,
  SORTS,
  sortLabel,
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
    expect(describeCriteria(parseSearchParams({ q: "Commerce", types: "commercial" }))).toBe(
      "Commercial property in Commerce",
    );
    expect(describeCriteria(parseSearchParams({ q: "Carnesville", types: "land" }))).toBe(
      "Land in Carnesville",
    );
  });

  it("accepts commercial as a property type and labels it", () => {
    const c = parseSearchParams({ types: "commercial,farm_ranch,skyscraper" });
    expect(c.types).toEqual(["commercial", "farm_ranch"]);
    expect(propertyTypeLabel("commercial")).toBe("Commercial");
    expect(serializeCriteria(c).get("types")).toBe("commercial,farm_ranch");
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

describe("sort labels", () => {
  it("labels every sort and renames newest in sold mode", () => {
    for (const s of SORTS) expect(SORT_LABELS[s]).toBeTruthy();
    expect(sortLabel("newest", "buy")).toBe("Newest");
    expect(sortLabel("newest", "rent")).toBe("Newest");
    expect(sortLabel("newest", "sold")).toBe("Recently sold");
    expect(sortLabel("price_asc", "sold")).toBe("Price (low to high)");
  });

  it("explains that there is no paid placement", () => {
    expect(SORT_HELP).toMatch(/^No paid placement\./);
  });
});

describe("parseViewParam", () => {
  it("accepts only map and list", () => {
    expect(parseViewParam("map")).toBe("map");
    expect(parseViewParam("list")).toBe("list");
    expect(parseViewParam("half")).toBeUndefined();
    expect(parseViewParam(null)).toBeUndefined();
    expect(parseViewParam(undefined)).toBeUndefined();
  });

  it("is not part of the criteria", () => {
    expect(serializeCriteria(parseSearchParams({ q: "Decatur", view: "map" })).toString()).toBe(
      "q=Decatur",
    );
  });

  it("finds the sheet position among the amenity filter's view=1", () => {
    expect(parseViewParam(["1", "list"])).toBe("list");
    expect(parseViewParam(["map", "1"])).toBe("map");
    expect(parseViewParam(["1"])).toBeUndefined();
    expect(parseViewParam("1")).toBeUndefined();
  });
});

describe("the shared view key", () => {
  it("keeps the View amenity filter when the sheet position is also present", () => {
    for (const qs of ["view=1&view=list", "view=list&view=1"]) {
      const c = parseSearchParams(new URLSearchParams(`q=Hartwell&${qs}`));
      expect(c.view).toBe(true);
      expect(serializeCriteria(c).toString()).toBe("q=Hartwell&view=1");
    }
    expect(parseSearchParams({ q: "Hartwell", view: ["map", "1"] }).view).toBe(true);
    expect(parseSearchParams({ view: ["map"] }).view).toBeUndefined();
  });

  it("setViewParam changes only the sheet position", () => {
    const p = new URLSearchParams("q=Hartwell&view=1");
    setViewParam(p, "list");
    expect(p.toString()).toBe("q=Hartwell&view=1&view=list");
    setViewParam(p, "map");
    expect(p.toString()).toBe("q=Hartwell&view=1&view=map");
    setViewParam(p, null);
    expect(p.toString()).toBe("q=Hartwell&view=1");

    const plain = new URLSearchParams("q=Hartwell&view=list");
    setViewParam(plain, undefined);
    expect(plain.toString()).toBe("q=Hartwell");
  });
});
