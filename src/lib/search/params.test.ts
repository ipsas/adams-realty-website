import { describe, expect, it } from "vitest";
import {
  clearedFilters,
  countActiveFilters,
  DEFAULT_CRITERIA,
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
  withPageHref,
} from "./params";

describe("withPageHref", () => {
  it("sets the page and keeps every other parameter", () => {
    expect(withPageHref({ q: "Royston", page: "9", view: ["list", "1"], from: "Royston" }, 3)).toBe(
      "/homes?q=Royston&view=list&view=1&from=Royston&page=3",
    );
    expect(withPageHref(new URLSearchParams("page=4&sort=newest"), 2)).toBe(
      "/homes?sort=newest&page=2",
    );
  });

  it("drops the parameter for page 1", () => {
    expect(withPageHref({ page: "2", beds: "3" }, 1)).toBe("/homes?beds=3");
    expect(withPageHref({ page: "2" }, 1)).toBe("/homes");
  });
});

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
    const acres = parseSearchParams({ minAcres: "10", maxAcres: "0.5" });
    expect([acres.minAcres, acres.maxAcres]).toEqual([0.5, 10]);
  });

  it("parses acreage, HOA, keywords, price reduced, 55+ and fireplace", () => {
    const c = parseSearchParams({
      minAcres: "0.25",
      maxAcres: "25",
      hoa: "no",
      kw: "  barn  workshop ",
      priceReduced: "1",
      age55: "exclude",
      fireplace: "1",
      minLotSqft: "43560",
    });
    expect(c).toMatchObject({
      minAcres: 0.25,
      maxAcres: 25,
      hoa: "no",
      kw: "barn  workshop",
      priceReduced: true,
      age55: "exclude",
      fireplace: true,
      // Legacy lot size still parses (old saved searches and links).
      minLotSqft: 43560,
    });
    expect(parseSearchParams({ kw: "x".repeat(200) }).kw).toHaveLength(80);
  });

  it("drops invalid acreage, HOA, keyword, price-reduced and 55+ values", () => {
    const c = parseSearchParams({
      minAcres: "-1",
      maxAcres: "200000",
      hoa: "maybe",
      kw: "   ",
      priceReduced: "yes",
      age55: "all",
      fireplace: "0",
    });
    expect(c).toEqual({ mode: "buy", sort: "recommended", page: 1 });
  });

  it("reads an empty or blank acreage bound as no bound, never 0", () => {
    for (const v of ["", " ", "%20"]) {
      const c = parseSearchParams(new URLSearchParams(`minAcres=${v}&maxAcres=${v}`));
      expect(c.minAcres).toBeUndefined();
      expect(c.maxAcres).toBeUndefined();
    }
    expect(parseSearchParams({ minAcres: "", maxAcres: " " })).toEqual(DEFAULT_CRITERIA);
    expect(parseSearchParams({ minAcres: " 2 " }).minAcres).toBe(2);
  });

  it("reads an acreage bound of 0 as no bound: not parsed, serialized or counted", () => {
    for (const v of ["0", "0.0", "00"]) {
      expect(parseSearchParams({ minAcres: v, maxAcres: v })).toEqual(DEFAULT_CRITERIA);
    }
    // maxAcres=0 is not swapped into a 0..10 range: min 10 stays, with no max.
    const c = parseSearchParams({ minAcres: "10", maxAcres: "0" });
    expect([c.minAcres, c.maxAcres]).toEqual([10, undefined]);
    const zeros = { ...DEFAULT_CRITERIA, minAcres: 0, maxAcres: 0 };
    expect(serializeCriteria(zeros).has("minAcres")).toBe(false);
    expect(serializeCriteria(zeros).has("maxAcres")).toBe(false);
    expect(countActiveFilters(zeros)).toBe(0);
    expect(countActiveFilters({ ...zeros, maxAcres: 5 })).toBe(1);
    expect(serializeCriteria({ ...zeros, maxAcres: 5 }).get("maxAcres")).toBe("5");
  });

  it("accepts only plain decimal numbers in numeric params", () => {
    const keys = [
      "minPrice",
      "maxPrice",
      "beds",
      "baths",
      "minSqft",
      "maxSqft",
      "minLotSqft",
      "minAcres",
      "maxAcres",
      "minYear",
      "maxYear",
      "maxHoa",
      "maxDaysOnMarket",
      "soldWithinDays",
    ] as const;
    const junk = [
      ...["", " ", "0x10", "1e3", "1E3", "Infinity", "-Infinity", "NaN", "+5", "-5"],
      ...["5.", ".5", "1.2.3", "0b11", "0o7", "1,000", "١٢"],
    ];
    for (const k of keys) {
      for (const v of junk) {
        expect(parseSearchParams({ [k]: v })[k], `${k}=${v}`).toBeUndefined();
      }
    }
    for (const v of ["0x10", "1e2", "Infinity", "+2", " ", "2.5"]) {
      expect(parseSearchParams({ page: v }).page, `page=${v}`).toBe(1);
    }
    // Plain decimals still parse; fractions only where they make sense.
    expect(
      parseSearchParams({ maxAcres: "0.25", baths: "1.5", beds: "3", page: "2" }),
    ).toMatchObject({ maxAcres: 0.25, baths: 1.5, beds: 3, page: 2 });
    expect(parseSearchParams({ minPrice: "250000", maxPrice: "250000.5" })).toMatchObject({
      minPrice: 250000,
    });
    expect(parseSearchParams({ maxPrice: "250000.5" }).maxPrice).toBeUndefined();
    expect(parseSearchParams({ beds: "2.5" }).beds).toBeUndefined();
  });

  it("drops price reduced in sold mode (a sold listing is not reduced)", () => {
    const sold = parseSearchParams({ mode: "sold", priceReduced: "1" });
    expect(sold.priceReduced).toBeUndefined();
    expect(countActiveFilters(sold)).toBe(0);
    expect(serializeCriteria(sold).has("priceReduced")).toBe(false);
    // A criteria object that still carries it (e.g. after switching to sold) doesn't count or serialize it.
    const carried = { ...DEFAULT_CRITERIA, mode: "sold" as const, priceReduced: true };
    expect(countActiveFilters(carried)).toBe(0);
    expect(serializeCriteria(carried).has("priceReduced")).toBe(false);
    expect(parseSearchParams({ mode: "buy", priceReduced: "1" }).priceReduced).toBe(true);
    expect(countActiveFilters({ ...carried, mode: "rent" })).toBe(1);
  });
});

describe("parseBounds", () => {
  it("rejects degenerate or out-of-range boxes", () => {
    expect(parseBounds("-97.7,30.3,-97.8,30.2")).toBeUndefined();
    expect(parseBounds("-200,30,-97,31")).toBeUndefined();
    expect(parseBounds("a,b,c,d")).toBeUndefined();
  });

  it("rejects blank, hex, exponent and infinite coordinates", () => {
    expect(parseBounds("-97.8,,-97.7,30.3")).toBeUndefined();
    expect(parseBounds("-97.8, ,-97.7,30.3")).toBeUndefined();
    expect(parseBounds("-97.8,0x10,-97.7,30.3")).toBeUndefined();
    expect(parseBounds("-97.8,3e1,-97.7,30.3")).toBeUndefined();
    expect(parseBounds("-Infinity,30.2,-97.7,30.3")).toBeUndefined();
    expect(parseBounds("-97.8,+30.2,-97.7,30.3")).toBeUndefined();
    expect(parseBounds("-97.8,30.2,-97.7,30.3")).toEqual({
      west: -97.8,
      south: 30.2,
      east: -97.7,
      north: 30.3,
    });
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

  it("round-trips the acreage, HOA, keyword, price-reduced, 55+ and fireplace filters", () => {
    const original = parseSearchParams({
      minAcres: "2",
      maxAcres: "10.5",
      hoa: "yes",
      kw: "dock",
      priceReduced: "1",
      age55: "only",
      fireplace: "1",
    });
    const p = serializeCriteria(original);
    expect(p.get("minAcres")).toBe("2");
    expect(p.get("hoa")).toBe("yes");
    expect(p.get("kw")).toBe("dock");
    expect(p.get("priceReduced")).toBe("1");
    expect(p.get("age55")).toBe("only");
    expect(p.get("fireplace")).toBe("1");
    expect(parseSearchParams(p)).toEqual(original);
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

  it("counts each new filter once (an acreage range is one filter)", () => {
    const c = parseSearchParams({
      minAcres: "1",
      maxAcres: "5",
      hoa: "no",
      kw: "barn",
      priceReduced: "1",
      age55: "exclude",
      fireplace: "1",
    });
    expect(countActiveFilters(c)).toBe(6);
    expect(countActiveFilters({ ...c, ...clearedFilters() })).toBe(0);
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
