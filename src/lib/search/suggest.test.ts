import { describe, expect, it } from "vitest";
import { lakeGuidesMatching, lakeOf, MAX_AREA_SUGGESTIONS, shapeAreaSuggestions } from "./suggest";

const row = (kind: string, label: string, sublabel: string | null, n: number) => ({
  kind,
  label,
  sublabel,
  n,
});

describe("location suggestions (site review #5)", () => {
  it("folds a lake's rows, one per town, into one 'lake area' suggestion", () => {
    const out = shapeAreaSuggestions("Lake Hart", [
      row("neighborhood", "Lake Hartwell", "Toccoa", 5),
      row("neighborhood", "Lake Hartwell", "Hartwell", 5),
      row("neighborhood", "Lake Hartwell", "Lavonia", 2),
    ]);
    expect(out).toEqual([
      {
        kind: "lake",
        label: "Lake Hartwell (lake area)",
        sublabel: "Hart, Franklin and Stephens counties",
        value: "Lake Hartwell",
        count: 12,
      },
    ]);
  });

  it("offers the town and its lake for 'Hartwell'", () => {
    const out = shapeAreaSuggestions("Hartwell", [row("city", "Hartwell", "GA", 14)]);
    expect(out.map((s) => [s.kind, s.label, s.value])).toEqual([
      ["city", "Hartwell", "Hartwell"],
      ["lake", "Lake Hartwell (lake area)", "Lake Hartwell"],
    ]);
  });

  it("finds a lake by any word of its names or aliases", () => {
    expect(lakeGuidesMatching("lan").map((a) => a.slug)).toEqual(["lake-lanier"]);
    expect(lakeGuidesMatching("sidney").map((a) => a.slug)).toEqual(["lake-lanier"]);
    expect(lakeGuidesMatching("hartw").map((a) => a.slug)).toEqual(["lake-hartwell"]);
    expect(lakeGuidesMatching("roy")).toEqual([]);
    expect(lakeGuidesMatching("l")).toEqual([]);
  });

  it("treats any 'Lake …' neighborhood as a lake, guide or not", () => {
    expect(lakeOf("Lake Oconee")).toBe("Lake Oconee");
    expect(lakeOf("Lanier")).toBe("Lake Lanier");
    expect(lakeOf("Cedar Cove")).toBeUndefined();
    const out = shapeAreaSuggestions("Lake O", [
      row("neighborhood", "Lake Oconee", "Greensboro", 4),
      row("neighborhood", "Lake Oconee", "Eatonton", 3),
    ]);
    expect(out).toEqual([
      {
        kind: "lake",
        label: "Lake Oconee (lake area)",
        sublabel: "Lake area",
        value: "Lake Oconee",
        count: 7,
      },
    ]);
  });

  it("keeps ordinary neighborhoods, cities and ZIPs as they were", () => {
    const out = shapeAreaSuggestions("30", [
      row("zip", "30662", "Royston", 9),
      row("neighborhood", "30 Oaks", "Royston", 1),
    ]);
    expect(out).toEqual([
      { kind: "zip", label: "30662", sublabel: "Royston", value: "30662", count: 9 },
      {
        kind: "neighborhood",
        label: "30 Oaks",
        sublabel: "Neighborhood in Royston",
        value: "30 Oaks",
        count: 1,
      },
    ]);
  });

  it("adds towns whose homes have all sold, after the rest, and never twice", () => {
    const out = shapeAreaSuggestions(
      "Ath",
      [row("city", "Athens", "GA", 7)],
      ["Athens", "Atherton"],
    );
    expect(out.map((s) => [s.label, s.sublabel])).toEqual([
      ["Athens", "GA"],
      ["Atherton", "No homes listed right now"],
    ]);
  });

  it("shows at most six areas, and a lake found by name always makes the cut", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row("city", `Hartwell ${i}`, "GA", 20 - i));
    const out = shapeAreaSuggestions("Hartwell", rows);
    expect(out).toHaveLength(MAX_AREA_SUGGESTIONS);
    expect(out.at(-1)?.kind).toBe("lake");
    expect(out.filter((s) => s.kind === "lake")).toHaveLength(1);
  });
});
