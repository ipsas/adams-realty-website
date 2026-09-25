import { describe, expect, it } from "vitest";
import {
  areaHref,
  areaRegions,
  areas,
  countyLabel,
  findArea,
  normalizeAreaName,
} from "@/config/areas";

describe("area config", () => {
  it("has unique, URL-safe slugs", () => {
    const slugs = areas.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("gives every area complete, well-formed content", () => {
    const regions = new Set(areaRegions.map((r) => r.id));
    for (const a of areas) {
      expect(regions.has(a.region), a.slug).toBe(true);
      expect(a.highlights.length, a.slug).toBeGreaterThanOrEqual(3);
      expect(a.highlights.length, a.slug).toBeLessThanOrEqual(4);
      const sentences = a.description.split(/(?<=[.!?])\s+/).length;
      expect(sentences, a.slug).toBeGreaterThanOrEqual(2);
      expect(sentences, a.slug).toBeLessThanOrEqual(3);
      expect(a.counties.length, a.slug).toBeGreaterThan(0);
      // Rough bounding box of the Northeast Georgia counties we serve.
      expect(a.center.lat, a.slug).toBeGreaterThan(33.9);
      expect(a.center.lat, a.slug).toBeLessThan(34.7);
      expect(a.center.lng, a.slug).toBeGreaterThan(-84.1);
      expect(a.center.lng, a.slug).toBeLessThan(-82.8);
    }
  });

  it("keeps copy about places, not people (fair housing)", () => {
    const risky =
      /\b(famil(y|ies)|kids|children|singles|young professionals|retirees|empty.nesters|safe|crime|school district|good schools|exclusive|ethnic|diverse|church-going|christian)\b/i;
    for (const a of areas) {
      const copy = [a.description, a.goodToKnow ?? "", ...a.highlights].join(" ");
      expect(copy, a.slug).not.toMatch(risky);
    }
  });

  it("groups every region's guides together, in region order (the index relies on it)", () => {
    const order = areaRegions.map((r) => r.id);
    const seen = areas.map((a) => order.indexOf(a.region));
    expect(seen).toEqual([...seen].sort((x, y) => x - y));
    for (const r of areaRegions) expect(areas.some((a) => a.region === r.id), r.id).toBe(true);
  });

  it("never lets two areas claim the same name or alias", () => {
    const seen = new Map<string, string>();
    for (const a of areas) {
      for (const key of new Set([a.slug, a.name, ...(a.aliases ?? [])].map(normalizeAreaName))) {
        expect(seen.get(key), `${key} claimed by ${seen.get(key)} and ${a.slug}`).toBeUndefined();
        seen.set(key, a.slug);
      }
    }
  });
});

describe("findArea", () => {
  it("finds by slug, name or alias, ignoring case and punctuation", () => {
    expect(findArea("lake-hartwell")?.name).toBe("Lake Hartwell");
    expect(findArea("Hartwell Lake")?.slug).toBe("lake-hartwell");
    expect(findArea("  FLOWERY-BRANCH ")?.slug).toBe("flowery-branch");
    expect(findArea("franklin-springs")?.city).toBe("Franklin Springs");
  });

  it("returns undefined for unknown or empty input", () => {
    expect(findArea("Athens")).toBeUndefined();
    expect(findArea("")).toBeUndefined();
    expect(findArea(null)).toBeUndefined();
  });
});

describe("labels", () => {
  it("formats one or many counties", () => {
    expect(countyLabel({ counties: ["Franklin"] })).toBe("Franklin County");
    expect(countyLabel({ counties: ["Hart", "Franklin", "Stephens"] })).toBe(
      "Hart, Franklin and Stephens counties",
    );
  });

  it("builds guide URLs", () => {
    expect(areaHref({ slug: "royston" })).toBe("/areas/royston");
  });
});
