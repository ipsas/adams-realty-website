import { describe, expect, it } from "vitest";
import { areas, findArea, type Area } from "@/config/areas";
import { NEARBY_GUIDES_HEADING, nearbyAreas } from "./nearby";

function area(slug: string, lat: number, lng: number): Area {
  return {
    slug,
    name: slug,
    city: slug,
    counties: ["Franklin"],
    region: "franklin",
    description: "",
    highlights: [],
    center: { lat, lng },
    updated: "2026-11-02",
  };
}

// On one meridian, so "a", "tie-y" and "tie-z" are exactly the same distance away.
const home = area("home", 0, 0);
const fixtures = [
  home,
  area("f", 0.6, 0),
  area("b", 0.1, 0),
  area("e", 0.5, 0),
  area("d", 0.3, 0),
  area("a", 0.2, 0),
  area("c", 0.4, 0),
  area("tie-z", -0.2, 0),
  area("tie-y", 0.2, 0),
];

const slugs = (list: Area[]) => list.map((a) => a.slug);

describe("nearbyAreas", () => {
  it("returns at most five, nearest first, ties by slug", () => {
    expect(slugs(nearbyAreas(home, fixtures))).toEqual(["b", "a", "tie-y", "tie-z", "d"]);
  });

  it("excludes the guide itself and the excluded slugs", () => {
    const got = slugs(nearbyAreas(home, fixtures, ["b", "tie-y"]));
    expect(got).toEqual(["a", "tie-z", "d", "c", "e"]);
    expect(got).not.toContain("home");
  });

  it("honors a smaller limit and returns nothing when everything is excluded", () => {
    expect(slugs(nearbyAreas(home, fixtures, [], 2))).toEqual(["b", "a"]);
    expect(nearbyAreas(home, [home], [])).toEqual([]);
  });

  it("links Toccoa to at least four distinct guides with its region's", () => {
    const toccoa = findArea("toccoa")!;
    const related = areas.filter((a) => a.region === toccoa.region && a.slug !== "toccoa");
    const nearby = nearbyAreas(toccoa, areas, slugs(related));
    expect(nearby.length).toBeGreaterThanOrEqual(3);
    expect(new Set([...slugs(related), ...slugs(nearby)]).size).toBeGreaterThanOrEqual(4);
  });

  it("links Royston to Hart County guides", () => {
    const royston = findArea("royston")!;
    const related = areas.filter((a) => a.region === royston.region && a.slug !== "royston");
    const nearby = slugs(nearbyAreas(royston, areas, slugs(related)));
    expect(nearby.some((s) => s === "hartwell" || s === "lake-hartwell")).toBe(true);
  });

  it("uses the approved heading", () => {
    expect(NEARBY_GUIDES_HEADING).toBe("Nearby town guides");
  });
});
