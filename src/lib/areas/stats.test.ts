import { describe, expect, it } from "vitest";
import { areas } from "@/config/areas";
import {
  addDays,
  emptyStats,
  formatAsOf,
  formatRatio,
  groupByRegion,
  leadPhotoFallback,
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
    // 11:30pm in Georgia is already the next day in UTC.
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
    const segs = mixSegments({ houses: 0, land: 3, attached: 0, other: 1 });
    expect(segs.map((s) => s.key)).toEqual(["land", "other"]);
    expect(segs.map((s) => s.label)).toEqual(["Land & farms", "Commercial & other"]);
    expect(segs.map((s) => s.pct)).toEqual([75, 25]);
  });

  it("rounds shares so they always sum to 100", () => {
    const thirds = mixSegments({ houses: 1, land: 1, attached: 1, other: 0 });
    expect(thirds.reduce((n, s) => n + s.pct, 0)).toBe(100);
    const lopsided = mixSegments({ houses: 5, land: 1, attached: 1, other: 0 });
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
    summary("royston", 5, 310_000),
    summary("lake-hartwell", 8, 745_000),
    summary("toccoa", 0, null),
    summary("lake-lanier", 7, 1_150_000),
  ];

  it("parses unknown sorts to the grouped default", () => {
    expect(parseAreaSort("price-low")).toBe("price-low");
    expect(parseAreaSort(["homes", "name"])).toBe("homes");
    expect(parseAreaSort("bogus")).toBe("region");
    expect(parseAreaSort(undefined)).toBe("region");
  });

  it("sorts by homes for sale, then name", () => {
    expect(sortAreas(list, "homes").map((s) => s.area.slug)).toEqual([
      "lake-hartwell",
      "lake-lanier",
      "royston",
      "toccoa",
    ]);
  });

  it("sinks areas without a median to the end of price sorts, both directions", () => {
    expect(sortAreas(list, "price-high").map((s) => s.area.slug)).toEqual([
      "lake-lanier",
      "lake-hartwell",
      "royston",
      "toccoa",
    ]);
    expect(sortAreas(list, "price-low").map((s) => s.area.slug)).toEqual([
      "royston",
      "lake-hartwell",
      "lake-lanier",
      "toccoa",
    ]);
  });

  it("sorts by name and leaves config order alone for region", () => {
    expect(sortAreas(list, "name").map((s) => s.area.name)).toEqual([
      "Lake Hartwell",
      "Lake Lanier",
      "Royston",
      "Toccoa",
    ]);
    expect(sortAreas(list, "region")).toEqual(list);
  });

  it("groups by region in the configured order", () => {
    const groups = groupByRegion([...list, summary("lavonia", 3, 289_000)]);
    expect(groups.map((g) => g.region.id)).toEqual([
      "franklin",
      "hartwell",
      "stephens",
      "hall-gwinnett",
    ]);
    expect(groups[0].items.map((s) => s.area.slug)).toEqual(["royston", "lavonia"]);
  });
});

describe("titles and meta descriptions", () => {
  const lake = areas.find((a) => a.slug === "lake-hartwell")!;
  const royston = areas.find((a) => a.slug === "royston")!;

  it("names lakes with their town and towns with the state", () => {
    expect(placeName(lake)).toBe("Lake Hartwell, Hartwell");
    expect(placeName(royston)).toBe("Royston, GA");
  });

  it("leads with live numbers and stays within the limit at a word boundary", () => {
    const d = metaDescription(lake, { forSale: 6, medianListPrice: 802_500 });
    expect(
      d.startsWith(
        "Lake Hartwell, Hartwell: 6 homes for sale, median list price $803K. Lake Hartwell is",
      ),
    ).toBe(true);
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("…")).toBe(true);
    expect(d).not.toMatch(/\s…$/);
  });

  it("skips the numbers when nothing is for sale", () => {
    const d = metaDescription(royston, { forSale: 0, medianListPrice: null });
    expect(d.startsWith("Royston, GA: Royston is a small city")).toBe(true);
  });

  it("returns short text untouched", () => {
    const d = metaDescription(
      { name: "X", city: "X", description: "Short." },
      { forSale: 1, medianListPrice: 500_000 },
    );
    expect(d).toBe("X, GA: 1 home for sale, median list price $500K. Short.");
  });
});

describe("leadPhotoFallback", () => {
  it("never says nothing is for sale when homes are listed", () => {
    expect(leadPhotoFallback(1, 0)).toEqual({
      text: "1 home for sale, photos coming soon.",
      target: "map",
    });
    expect(leadPhotoFallback(3, 5).text).toBe("3 homes for sale, photos coming soon.");
  });

  it("points down the page only when there are sales to point to", () => {
    expect(leadPhotoFallback(0, 2)).toEqual({
      text: "Nothing for sale right now. Recent sales are below.",
      target: "sales",
    });
    const none = leadPhotoFallback(0, 0);
    expect(none.target).toBe("map");
    expect(none.text).not.toMatch(/sales are below/);
  });
});
