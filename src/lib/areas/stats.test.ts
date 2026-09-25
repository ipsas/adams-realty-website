import { describe, expect, it } from "vitest";
import { areas } from "@/config/areas";
import {
  addDays,
  emptyStats,
  formatAsOf,
  formatRatio,
  groupByRegion,
  marketToday,
  metaDescription,
  mixSegments,
  parseAreaSort,
  placeName,
  sampleLabel,
  sortAreas,
  type AreaSummary,
} from "./stats";

describe("market dates", () => {
  it("uses the market's calendar date, not UTC", () => {
    // 11:30pm in Atlanta is already the next day in UTC.
    expect(marketToday(new Date("2026-09-26T03:30:00Z"))).toBe("2026-09-25");
    expect(marketToday(new Date("2026-09-26T04:30:00Z"))).toBe("2026-09-26");
  });

  it("shifts dates across month and year boundaries", () => {
    expect(addDays("2026-09-25", -30)).toBe("2026-08-26");
    expect(addDays("2026-09-25", -180)).toBe("2026-03-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09");
  });
});

describe("mixSegments", () => {
  it("returns nothing when nothing is for sale", () => {
    expect(mixSegments(emptyStats().mix)).toEqual([]);
  });

  it("keeps fixed bucket order and colors, drops empty buckets", () => {
    const segs = mixSegments({ singleFamily: 0, townhouse: 1, condo: 3, other: 0 });
    expect(segs.map((s) => s.key)).toEqual(["townhouse", "condo"]);
    expect(segs.map((s) => s.pct)).toEqual([25, 75]);
  });

  it("rounds shares so they always sum to 100", () => {
    const thirds = mixSegments({ singleFamily: 1, townhouse: 1, condo: 1, other: 0 });
    expect(thirds.reduce((n, s) => n + s.pct, 0)).toBe(100);
    const lopsided = mixSegments({ singleFamily: 5, townhouse: 1, condo: 1, other: 0 });
    expect(lopsided.map((s) => s.pct)).toEqual([72, 14, 14]);
    expect(lopsided.reduce((n, s) => n + s.pct, 0)).toBe(100);
  });
});

describe("formatRatio", () => {
  it("rounds to whole percents", () => {
    expect(formatRatio(0.9832)).toBe("98%");
    expect(formatRatio(1.021)).toBe("102%");
    expect(formatRatio(1)).toBe("100%");
  });

  it("never rounds a near-list median to exactly 100%", () => {
    expect(formatRatio(0.996)).toBe("99.6%");
    expect(formatRatio(1.004)).toBe("100.4%");
  });
});

describe("formatAsOf", () => {
  it("labels the time in the market's zone, DST-aware", () => {
    expect(formatAsOf(new Date("2026-09-25T19:42:00Z"))).toBe("Sep 25, 3:42 PM EDT");
    expect(formatAsOf(new Date("2026-12-01T14:05:00Z"))).toBe("Dec 1, 9:05 AM EST");
  });
});

describe("sampleLabel", () => {
  it("pluralizes", () => {
    expect(sampleLabel(1, ["sale", "sales"])).toBe("1 sale");
    expect(sampleLabel(4, ["sale", "sales"])).toBe("4 sales");
  });
});

describe("sorting and grouping", () => {
  const summary = (slug: string, forSale: number, medianListPrice: number | null): AreaSummary => {
    const area = areas.find((a) => a.slug === slug)!;
    return { area, stats: { ...emptyStats(), forSale, medianListPrice } };
  };
  const list = [
    summary("midtown", 5, 600_000),
    summary("buckhead", 8, 1_400_000),
    summary("roswell", 0, null),
    summary("lake-lanier", 7, 900_000),
  ];

  it("parses unknown sorts to the grouped default", () => {
    expect(parseAreaSort("price-low")).toBe("price-low");
    expect(parseAreaSort(["homes", "name"])).toBe("homes");
    expect(parseAreaSort("bogus")).toBe("region");
    expect(parseAreaSort(undefined)).toBe("region");
  });

  it("sorts by homes for sale, then name", () => {
    expect(sortAreas(list, "homes").map((s) => s.area.slug)).toEqual([
      "buckhead",
      "lake-lanier",
      "midtown",
      "roswell",
    ]);
  });

  it("sinks areas without a median to the end of price sorts, both directions", () => {
    expect(sortAreas(list, "price-high").map((s) => s.area.slug)).toEqual([
      "buckhead",
      "lake-lanier",
      "midtown",
      "roswell",
    ]);
    expect(sortAreas(list, "price-low").map((s) => s.area.slug)).toEqual([
      "midtown",
      "lake-lanier",
      "buckhead",
      "roswell",
    ]);
  });

  it("sorts by name and leaves config order alone for region", () => {
    expect(sortAreas(list, "name").map((s) => s.area.name)).toEqual([
      "Buckhead",
      "Lake Lanier",
      "Midtown",
      "Roswell",
    ]);
    expect(sortAreas(list, "region")).toEqual(list);
  });

  it("groups by region in the configured order", () => {
    const groups = groupByRegion(list);
    expect(groups.map((g) => g.region.id)).toEqual(["intown", "north", "lake"]);
    expect(groups[0].items.map((s) => s.area.slug)).toEqual(["midtown", "buckhead"]);
  });
});

describe("titles and meta descriptions", () => {
  const midtown = areas.find((a) => a.slug === "midtown")!;
  const decatur = areas.find((a) => a.slug === "decatur")!;

  it("names neighborhoods with their city and cities with the state", () => {
    expect(placeName(midtown)).toBe("Midtown, Atlanta");
    expect(placeName(decatur)).toBe("Decatur, GA");
  });

  it("leads with live numbers and stays within the limit at a word boundary", () => {
    const d = metaDescription(midtown, { forSale: 6, medianListPrice: 802_500 });
    expect(
      d.startsWith("Midtown, Atlanta: 6 homes for sale, median list price $803K. Midtown is"),
    ).toBe(true);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("…")).toBe(true);
    expect(d).not.toMatch(/\s…$/);
  });

  it("skips the numbers when nothing is for sale", () => {
    const d = metaDescription(decatur, { forSale: 0, medianListPrice: null });
    expect(d.startsWith("Decatur, GA: Decatur is an independent city")).toBe(true);
  });

  it("returns short text untouched", () => {
    const d = metaDescription(
      { name: "X", city: "X", description: "Short." },
      { forSale: 1, medianListPrice: 500_000 },
    );
    expect(d).toBe("X, GA: 1 home for sale, median list price $500K. Short.");
  });
});
