import { describe, expect, it } from "vitest";
import { HOME_TOWN_GUIDE_SLUGS, areas } from "./areas";

describe("HOME_TOWN_GUIDE_SLUGS", () => {
  it("lists the 12 home-page area guides in order", () => {
    expect(HOME_TOWN_GUIDE_SLUGS).toEqual([
      "gainesville",
      "lake-lanier",
      "flowery-branch",
      "oakwood",
      "buford",
      "braselton",
      "commerce",
      "royston",
      "lavonia",
      "hartwell",
      "lake-hartwell",
      "toccoa",
    ]);
  });

  it("every slug is an area in the config with a name", () => {
    for (const slug of HOME_TOWN_GUIDE_SLUGS) {
      const area = areas.find((a) => a.slug === slug);
      expect(area, slug).toBeDefined();
      expect(area?.name.trim(), slug).not.toBe("");
    }
  });
});
