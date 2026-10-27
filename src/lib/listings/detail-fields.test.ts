import { describe, expect, it } from "vitest";
import { MAX_PLAUSIBLE_LOT_SQFT } from "@/lib/search/query";
import {
  editorAssociationYN,
  hoaFact,
  hoaStatus,
  listingDetailGroups,
  type DetailListing,
} from "./detail-fields";
import { EXCLUDED_FIELD_KEYS, isExcludedField } from "./excluded-fields";

const empty: DetailListing = {
  features: {},
  fireplacesTotal: null,
  parkingTotal: null,
  garageSpaces: null,
  lotSizeSqft: null,
  lotSizeDimensions: null,
  neighborhood: null,
  associationYN: null,
  hoaFee: null,
  hoaFrequency: null,
  seniorCommunity: null,
  taxAnnualAmount: null,
  taxYear: null,
  taxAssessedValue: null,
  zoning: null,
};

const rows = (l: Partial<DetailListing>) =>
  Object.fromEntries(
    listingDetailGroups({ ...empty, ...l })
      .flatMap((g) => g.rows)
      .map((r) => [r.label, r.value]),
  );

const filled: DetailListing = {
  features: {
    interior: ["Walk-In Closet(s)"],
    exterior: ["Gutters"],
    appliances: ["Dishwasher"],
    heating: ["Heat Pump"],
    cooling: ["Central Air"],
    parking: ["Attached", "Garage"],
    flooring: ["Hardwood"],
    community: ["Lake"],
    utilities: ["Cable Available"],
    view: ["Lake"],
    construction: ["Brick"],
    lot: ["Level"],
    sewer: ["Septic Tank"],
    water: ["Public"],
    roof: ["Composition"],
    foundation: ["Slab"],
    style: ["Ranch"],
    fireplace: ["Living Room"],
    basement: ["Finished"],
    patioPorch: ["Deck"],
    fencing: ["Wood"],
    laundry: ["Laundry Room"],
    accessibility: ["Accessible Doors"],
    greenEnergy: ["Solar"],
    otherStructures: ["Barn(s)"],
    associationFeeIncludes: ["Maintenance Grounds"],
    associationAmenities: ["Clubhouse"],
    roadFrontage: ["County Road"],
    roadSurface: ["Paved"],
    windows: ["Double Pane Windows"],
    security: ["Smoke Detector(s)"],
    waterfront: ["Lake Front"],
    electric: ["220 Volts"],
    levels: ["One"],
    condition: ["Resale"],
    specialConditions: ["Standard"],
    listingTerms: ["Cash", "Conventional"],
    currentUse: ["Residential"],
    possibleUse: ["Agricultural"],
    horse: ["Pasture"],
    spa: ["Bath"],
  },
  fireplacesTotal: 2,
  parkingTotal: 4,
  garageSpaces: 2,
  lotSizeSqft: 43_560,
  lotSizeDimensions: "100 x 200",
  neighborhood: "Lakeside",
  associationYN: true,
  hoaFee: 300,
  hoaFrequency: "annually",
  seniorCommunity: true,
  taxAnnualAmount: 2345,
  taxYear: 2025,
  taxAssessedValue: 120_000,
  zoning: "R-1",
};

describe("listingDetailGroups", () => {
  it("returns nothing for an empty listing", () => {
    expect(listingDetailGroups(empty)).toEqual([]);
  });

  it("hides empty arrays, zeros, nulls and placeholders", () => {
    expect(
      listingDetailGroups({
        ...empty,
        features: { sewer: [], roof: [""], parking: [] },
        fireplacesTotal: 0,
        parkingTotal: 0,
        garageSpaces: 0,
        lotSizeSqft: 0,
        taxAnnualAmount: 0,
        taxAssessedValue: 0,
        neighborhood: "None",
        zoning: " ",
        seniorCommunity: false,
      }),
    ).toEqual([]);
  });

  it("joins arrays with commas", () => {
    expect(rows({ features: { listingTerms: ["Cash", "FHA"] } })["Listing terms"]).toBe(
      "Cash, FHA",
    );
  });

  it("says HOA Yes, No, or nothing when unknown", () => {
    expect(rows({ associationYN: true }).HOA).toBe("Yes");
    expect(rows({ hoaFee: 50 }).HOA).toBe("Yes");
    expect(rows({ associationYN: false }).HOA).toBe("No");
    expect(rows({ hoaFee: 0 }).HOA).toBe("No");
    expect(rows({}).HOA).toBeUndefined();
  });

  it("formats the HOA fee by frequency", () => {
    expect(rows({ hoaFee: 50 })["HOA fee"]).toBe("$50/month");
    expect(rows({ hoaFee: 50, hoaFrequency: "monthly" })["HOA fee"]).toBe("$50/month");
    expect(rows({ hoaFee: 150, hoaFrequency: "quarterly" })["HOA fee"]).toBe("$150/quarter");
    expect(rows({ hoaFee: 1200, hoaFrequency: "annually" })["HOA fee"]).toBe("$1,200/year");
    expect(rows({ hoaFee: 0 })["HOA fee"]).toBeUndefined();
  });

  it("shows a plausible lot size in acres and hides an absurd one", () => {
    expect(rows({ lotSizeSqft: 2 * 43_560 })["Lot size"]).toBe("2 acres");
    expect(rows({ lotSizeSqft: MAX_PLAUSIBLE_LOT_SQFT + 1 })["Lot size"]).toBeUndefined();
  });

  it("adds the tax year when it is a real one", () => {
    expect(rows({ taxAnnualAmount: 2345, taxYear: 2025 })["Annual tax amount"]).toBe(
      "$2,345 (2025)",
    );
    expect(rows({ taxAnnualAmount: 2345, taxYear: 24 })["Annual tax amount"]).toBe("$2,345 (2024)");
    expect(rows({ taxAnnualAmount: 2345, taxYear: 1200 })["Annual tax amount"]).toBe("$2,345");
    expect(rows({ taxAnnualAmount: 2345 })["Annual tax amount"]).toBe("$2,345");
  });

  it("keeps the group order", () => {
    expect(listingDetailGroups(filled).map((g) => g.title)).toEqual([
      "Interior",
      "Exterior and lot",
      "Construction",
      "Utilities",
      "Parking",
      "Community and HOA",
      "Taxes and financial",
    ]);
  });

  it("never lists compensation, showing, lockbox or occupant details", () => {
    const labels = listingDetailGroups(filled).flatMap((g) => g.rows.map((r) => r.label));
    expect(labels.length).toBeGreaterThan(40);
    for (const label of labels) expect(label).not.toMatch(/compens|showing|lockbox|occupant/i);
  });

  it("emits nothing excluded even when the listing and its features carry excluded keys", () => {
    const SENTINEL = "EXCLUDED-VALUE";
    const tainted = {
      ...filled,
      features: {
        ...filled.features,
        ...Object.fromEntries(
          EXCLUDED_FIELD_KEYS.flatMap((k) => [
            [k, [SENTINEL]],
            [k.charAt(0).toLowerCase() + k.slice(1), [SENTINEL]],
          ]),
        ),
      },
      ...Object.fromEntries(EXCLUDED_FIELD_KEYS.map((k) => [k, SENTINEL])),
    } as DetailListing;
    const out = listingDetailGroups(tainted);
    const rowsOut = out.flatMap((g) => g.rows);
    expect(rowsOut.length).toBe(listingDetailGroups(filled).flatMap((g) => g.rows).length);
    expect(JSON.stringify(out)).not.toContain(SENTINEL);
    for (const r of rowsOut) expect(isExcludedField(r.label), r.label).toBe(false);
  });

  it("never shows a literal null, undefined or placeholder as a value or list item", () => {
    const junk = ["null", "NULL", " Null ", "undefined", "Undefined", "None", "N/A", " "];
    expect(
      listingDetailGroups({
        ...empty,
        features: { sewer: junk, roof: ["undefined"], fencing: ["null", "n/a"] },
        lotSizeDimensions: "null",
        neighborhood: "undefined",
        zoning: " NULL ",
      }),
    ).toEqual([]);
    const r = rows({ features: { sewer: ["Septic Tank", "null", "undefined", "Public Sewer"] } });
    expect(r.Sewer).toBe("Septic Tank, Public Sewer");
    expect(JSON.stringify(listingDetailGroups({ ...filled, zoning: "null" }))).not.toMatch(
      /null|undefined/i,
    );
  });
});

describe("hoaFact", () => {
  it("shows the fee when there is one", () => {
    expect(hoaFact({ associationYN: null, hoaFee: 50, hoaFrequency: null })).toBe("$50/mo");
    expect(hoaFact({ associationYN: true, hoaFee: 150, hoaFrequency: "quarterly" })).toBe(
      "$150/qtr",
    );
    expect(hoaFact({ associationYN: true, hoaFee: 600, hoaFrequency: "annually" })).toBe("$600/yr");
  });

  it('says "None" only when the MLS says so', () => {
    expect(hoaFact({ associationYN: false, hoaFee: null, hoaFrequency: null })).toBe("None");
    expect(hoaFact({ associationYN: null, hoaFee: 0, hoaFrequency: null })).toBe("None");
  });

  it("omits the fact when HOA is unknown", () => {
    expect(hoaFact({ associationYN: null, hoaFee: null, hoaFrequency: null })).toBeNull();
  });

  it('says "Yes" for an association with no fee or a $0 fee (never "None" or "$0")', () => {
    expect(hoaFact({ associationYN: true, hoaFee: null, hoaFrequency: null })).toBe("Yes");
    expect(hoaFact({ associationYN: true, hoaFee: 0, hoaFrequency: "monthly" })).toBe("Yes");
    expect(rows({ associationYN: true, hoaFee: 0 }).HOA).toBe("Yes");
    expect(rows({ associationYN: true, hoaFee: 0 })["HOA fee"]).toBeUndefined();
    expect(rows({ associationYN: true, hoaFee: null }).HOA).toBe("Yes");
  });
});

describe("hoaStatus (the page's and the HOA filter's rule)", () => {
  it("is yes for a true flag or a fee, no for a false flag or $0 fee, else unknown", () => {
    expect(hoaStatus({ associationYN: true, hoaFee: null })).toBe(true);
    expect(hoaStatus({ associationYN: true, hoaFee: 0 })).toBe(true);
    expect(hoaStatus({ associationYN: null, hoaFee: 50 })).toBe(true);
    expect(hoaStatus({ associationYN: false, hoaFee: 50 })).toBe(true);
    expect(hoaStatus({ associationYN: false, hoaFee: null })).toBe(false);
    expect(hoaStatus({ associationYN: null, hoaFee: 0 })).toBe(false);
    expect(hoaStatus({ associationYN: null, hoaFee: null })).toBeNull();
  });
});

describe("editorAssociationYN (dashboard listing editor)", () => {
  it("sets the flag for a fee above $0 and clears it otherwise", () => {
    expect(editorAssociationYN(250)).toBe(true);
    expect(editorAssociationYN(0)).toBeNull();
    expect(editorAssociationYN(undefined)).toBeNull();
    expect(editorAssociationYN(null)).toBeNull();
  });

  it("so a cleared fee shows no HOA fact, and a $0 fee shows None", () => {
    const after = (fee: number | undefined) => ({
      associationYN: editorAssociationYN(fee),
      hoaFee: fee ?? null,
      hoaFrequency: fee ? ("monthly" as const) : null,
    });
    expect(hoaFact(after(250))).toBe("$250/mo");
    expect(hoaFact(after(undefined))).toBeNull();
    expect(hoaFact(after(0))).toBe("None");
  });
});
