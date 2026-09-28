import { describe, expect, it } from "vitest";
import { letterAnchors, placesIndexView } from "./places-index";

const groups = [
  { county: "Chatham", cities: [{ city: "Savannah", count: 16 }] },
  {
    county: "Franklin",
    cities: [
      { city: "Lavonia", count: 3 },
      { city: "Royston", count: 12 },
    ],
  },
  { county: "Fulton", cities: [{ city: "Atlanta", count: 30 }] },
  // Royston crosses into Hart County; it's listed under both.
  { county: "Hart County", cities: [{ city: "Royston", count: 2 }] },
  { county: null, cities: [{ city: "Nowhere", count: 1 }] },
];

describe("placesIndexView", () => {
  const view = placesIndexView(groups);

  it("labels and anchors each county, with its homes", () => {
    expect(view.counties.map((c) => [c.label, c.id, c.homes])).toEqual([
      ["Chatham County", "chatham-county", 16],
      ["Franklin County", "franklin-county", 15],
      ["Fulton County", "fulton-county", 30],
      ["Hart County", "hart-county", 2],
      ["County not listed", "no-county", 1],
    ]);
  });

  it("marks only the firm's counties", () => {
    expect(view.counties.filter((c) => c.firmCounty).map((c) => c.label)).toEqual([
      "Franklin County",
      "Hart County",
    ]);
  });

  it("counts each town once and every home once", () => {
    expect(view.towns).toBe(5); // Savannah, Lavonia, Royston, Atlanta, Nowhere
    expect(view.homes).toBe(64);
  });

  it("gives jump links to the first county of each letter", () => {
    expect(view.letters).toEqual(["C", "F", "H"]);
    expect([...letterAnchors(view.counties)]).toEqual([
      ["chatham-county", "letter-c"],
      ["franklin-county", "letter-f"],
      ["hart-county", "letter-h"],
    ]);
  });

  it("is empty with no homes for sale", () => {
    expect(placesIndexView([])).toEqual({ counties: [], towns: 0, homes: 0, letters: [] });
  });
});
