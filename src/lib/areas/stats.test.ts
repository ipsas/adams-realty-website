import { describe, expect, it } from "vitest";
import { areas } from "@/config/areas";
import {
  addDays,
  emptyStats,
  formatAsOf,
  formatRatio,
  gridWithoutLead,
  groupByRegion,
  leadPhotoFallback,
  marketToday,
  metaDescription,
  mixSegments,
  parseAreaSort,
  placeName,
  sampleLabel,
  snapshotTiles,
  sortAreas,
  type AreaStats,
  type AreaSummary,
} from "./stats";

describe("snapshotTiles", () => {
  const full: AreaStats = {
    ...emptyStats(),
    forSale: 40,
    medianListPrice: 350_000,
    minListPrice: 90_000,
    maxListPrice: 2_000_000,
    medianPricePerSqft: 180,
    pricePerSqftSample: 30,
    medianPricePerAcre: 12_000,
    pricePerAcreSample: 5,
    medianDaysOnMarket: 41,
    daysOnMarketSample: 38,
    newListings: 0,
    listDateSample: 38,
    recentSales: 12,
    medianSoldPrice: 320_000,
    medianSaleToList: 0.97,
  };

  it("shows every tile that can be calculated, in order (a real 0 new listings included)", () => {
    expect(snapshotTiles(full)).toEqual([
      "forSale",
      "listPrice",
      "pricePerSqft",
      "pricePerAcre",
      "daysOnMarket",
      "newListings",
      "sales",
    ]);
  });

  it("hides figures whose inputs are missing instead of showing 0 or a dash", () => {
    // Live Gainesville: hundreds for sale, but no list dates and no closed sales in the feed.
    const noDates = {
      ...full,
      medianDaysOnMarket: null,
      daysOnMarketSample: 0,
      listDateSample: 0,
      recentSales: 0,
      medianSoldPrice: null,
      medianSaleToList: null,
    };
    expect(snapshotTiles(noDates)).toEqual([
      "forSale",
      "listPrice",
      "pricePerSqft",
      "pricePerAcre",
    ]);
    expect(
      snapshotTiles({ ...full, pricePerSqftSample: 0, medianPricePerSqft: null }),
    ).not.toContain("pricePerSqft");
    expect(
      snapshotTiles({ ...full, pricePerAcreSample: 0, medianPricePerAcre: null }),
    ).not.toContain("pricePerAcre");
  });

  it("keeps the homes-for-sale count even when nothing is for sale", () => {
    expect(snapshotTiles(emptyStats())).toEqual(["forSale"]);
  });
});

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
      "hall-gwinnett",
      "franklin",
      "hartwell",
      "stephens",
    ]);
    expect(groups.find((g) => g.region.id === "franklin")!.items.map((s) => s.area.slug)).toEqual([
      "royston",
      "lavonia",
    ]);
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

describe("gridWithoutLead", () => {
  // The page fetches one past the grid size (9 for a grid of 8).
  const newest = Array.from({ length: 9 }, (_, i) => ({ id: `h${i + 1}` }));
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  it("drops the lead home wherever it falls and backfills to a full grid", () => {
    for (const lead of newest) {
      const grid = gridWithoutLead(newest, lead, 8);
      expect(ids(grid)).not.toContain(lead.id);
      expect(grid).toHaveLength(8);
    }
    expect(ids(gridWithoutLead(newest, { id: "h1" }, 8))).toEqual(ids(newest.slice(1)));
  });

  it("keeps the newest eight when the lead isn't among them, or there is no lead", () => {
    expect(gridWithoutLead(newest, { id: "elsewhere" }, 8)).toEqual(newest.slice(0, 8));
    expect(gridWithoutLead(newest, null, 8)).toEqual(newest.slice(0, 8));
  });

  it("shows every other home when there are too few to fill the grid", () => {
    const few = newest.slice(0, 3);
    expect(ids(gridWithoutLead(few, { id: "h2" }, 8))).toEqual(["h1", "h3"]);
    expect(gridWithoutLead([{ id: "h1" }], { id: "h1" }, 8)).toEqual([]);
  });
});
