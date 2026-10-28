import { describe, expect, it } from "vitest";
import { countyDisplay } from "@/lib/areas/match";
import { GEORGIA_COUNTIES } from "@/test/georgia-counties";
import {
  countyPrefix,
  lakeGuidesMatching,
  lakeOf,
  MAX_AREA_SUGGESTIONS,
  shapeAreaSuggestions,
} from "./suggest";

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

  it("offers a county first when the text names it, and drops a neighborhood of its name", () => {
    for (const term of [
      "Hall",
      "Hall Co",
      "Hall cou",
      "Hall County",
      "hall county, GA",
      "Hall County, G",
      "Hall Co, Georgia",
      "Hall, GA",
    ]) {
      const out = shapeAreaSuggestions(
        term,
        [
          row("neighborhood", "Hall County", "Clermont", 1),
          row("neighborhood", "Hall Farm", "Comer", 2),
        ],
        [],
        [{ county: "HALL", n: 412 }],
      );
      expect(out[0]).toEqual({
        kind: "county",
        label: "Hall",
        sublabel: "County",
        value: "Hall County",
        count: 412,
      });
      expect(out.map((s) => s.value)).toEqual(["Hall County", "Hall Farm"]);
    }
  });

  it("puts a county the text only starts before the places", () => {
    const out = shapeAreaSuggestions(
      "Hal",
      [row("city", "Halcyon", "GA", 14)],
      [],
      [{ county: "Hall", n: 412 }],
    );
    expect(out.map((s) => [s.kind, s.label])).toEqual([
      ["county", "Hall"],
      ["city", "Halcyon"],
    ]);
  });

  it("orders 'Clay': the county named, the other counties, then the places", () => {
    const out = shapeAreaSuggestions(
      "Clay",
      [row("city", "Clayton", "GA", 20), row("neighborhood", "Clay Hills", "Athens", 2)],
      [],
      [
        { county: "CLAYTON", n: 300 },
        { county: "CLAY", n: 4 },
      ],
    );
    expect(out.map((s) => [s.kind, s.value])).toEqual([
      ["county", "Clay County"],
      ["county", "Clayton County"],
      ["city", "Clayton"],
      ["neighborhood", "Clay Hills"],
    ]);
  });

  it("names a county once, tagged County, for every Georgia county however the feed spells it", () => {
    for (const name of GEORGIA_COUNTIES) {
      for (const county of [name, name.toUpperCase(), name.toLowerCase()].flatMap((v) => [
        v,
        `${v} County`,
      ])) {
        const [s] = shapeAreaSuggestions(name, [], [], [{ county, n: 1 }]);
        expect(s).toEqual({
          kind: "county",
          label: name,
          sublabel: "County",
          value: `${name} County`,
          count: 1,
        });
        expect(`${s.label} ${s.sublabel}`).toBe(`${name} County`);
        expect(`${s.label} ${s.sublabel}`).not.toMatch(/county county/i);
      }
    }
  });

  it("puts DeKalb first however its name is typed", () => {
    for (const term of ["De Kalb", "dekalb", "De'Kalb county", "De Ka"]) {
      const out = shapeAreaSuggestions(
        term,
        [row("city", "Dekalb Park", "GA", 3)],
        [],
        [{ county: "DEKALB", n: 9 }],
      );
      expect(out.map((s) => [s.label, s.sublabel])).toEqual([
        ["DeKalb", "County"],
        ["Dekalb Park", "GA"],
      ]);
    }
  });

  it("reads the county name typed so far", () => {
    expect(countyPrefix("Hall Co")).toBe("hall");
    expect(countyPrefix("hall county, GA")).toBe("hall");
    expect(countyPrefix("gwinnett")).toBe("gwinnett");
    expect(countyPrefix("Gwin")).toBe("gwin");
    expect(countyPrefix("30501")).toBe("");
  });

  it("reads a half-typed County word or state", () => {
    for (const term of [
      "Hall Co",
      "Hall cou",
      "hall COUN",
      "Hall County, G",
      "Hall County, Ga",
      "Hall County, Geor",
      "Hall, GA",
      "Hall, g",
      "Hall Co, Georgia",
      "Hall Co Ge",
      "Hall county ga",
    ]) {
      expect(countyPrefix(term), term).toBe("hall");
    }
    // A lone letter not after a comma or County word is part of the name.
    expect(countyPrefix("Hall G")).toBe("hall g");
    expect(countyPrefix("Hall Cove")).toBe("hall cove");
    expect(countyPrefix("Coco")).toBe("coco");
  });

  it("reads DeKalb, McDuffie and McIntosh spelled or spaced any way, partly typed too", () => {
    expect(countyPrefix("De Kalb")).toBe("dekalb");
    expect(countyPrefix("de kalb county")).toBe("dekalb");
    expect(countyPrefix("De'Kalb")).toBe("dekalb");
    expect(countyPrefix("De Ka")).toBe("deka");
    expect(countyPrefix("Mc Duf")).toBe("mcduf");
    expect(countyPrefix("mcdu")).toBe("mcdu");
    expect(countyPrefix("Mc'Duffie Co")).toBe("mcduffie");
    expect(countyPrefix("Mc Intosh")).toBe("mcintosh");
    expect(countyPrefix("Ben Hi")).toBe("ben hi");
  });

  it("shows a county as the feed spells it, title-cased when in capitals", () => {
    expect(countyDisplay("HALL")).toBe("Hall County");
    expect(countyDisplay("hall county")).toBe("Hall County");
    expect(countyDisplay("DeKalb")).toBe("DeKalb County");
    expect(countyDisplay("JEFF DAVIS COUNTY")).toBe("Jeff Davis County");
  });

  it("shows at most six areas, and a lake found by name always makes the cut", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row("city", `Hartwell ${i}`, "GA", 20 - i));
    const out = shapeAreaSuggestions("Hartwell", rows);
    expect(out).toHaveLength(MAX_AREA_SUGGESTIONS);
    expect(out.at(-1)?.kind).toBe("lake");
    expect(out.filter((s) => s.kind === "lake")).toHaveLength(1);
  });
});
