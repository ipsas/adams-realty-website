import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isExcludedField } from "@/lib/listings/excluded-fields";
import {
  attribution,
  compensation,
  EXCLUDED_FIELDS,
  list,
  mainLevelBedroomFacts,
  mapPropertyType,
  mapResoProperty,
  mapStatus,
  monthlyLeaseAmount,
  taxYear,
  type ResoProperty,
} from "./mapper";

const base: ResoProperty = {
  ListingKey: "abc123",
  ListingId: "ACT1234567",
  StandardStatus: "Active",
  PropertyType: "Residential",
  PropertySubType: "Single Family Residence",
  ListPrice: 725000,
  StreetNumber: "1204",
  StreetName: "Travis Heights",
  StreetSuffix: "Blvd",
  City: "Austin",
  StateOrProvince: "TX",
  PostalCode: "78704-1234",
  Latitude: 30.2465,
  Longitude: -97.7412,
  BedroomsTotal: 3,
  BathroomsFull: 2,
  BathroomsHalf: 1,
  LivingArea: 1850,
  LotSizeAcres: 0.18,
  ModificationTimestamp: "2026-09-20T15:30:00Z",
  Media: [
    { MediaKey: "m2", MediaURL: "https://cdn.example.com/2.jpg", Order: 2 },
    {
      MediaKey: "m1",
      MediaURL: "https://cdn.example.com/1.jpg",
      Order: 1,
      ShortDescription: "Front",
    },
    {
      MediaKey: "fp",
      MediaURL: "https://cdn.example.com/fp.jpg",
      Order: 3,
      MediaCategory: "Floor Plan",
    },
    { MediaKey: "bad", MediaURL: "javascript:alert(1)", Order: 4 },
  ],
};

function mapOk(p: ResoProperty) {
  const r = mapResoProperty(p);
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`);
  return r.listing;
}

describe("mapResoProperty", () => {
  it("maps core fields", () => {
    const l = mapOk(base);
    expect(l).toMatchObject({
      listingKey: "abc123",
      mlsNumber: "ACT1234567",
      status: "active",
      propertyType: "single_family",
      transactionType: "sale",
      listPrice: 725000,
      addressLine1: "1204 Travis Heights Blvd",
      postalCode: "78704",
      bedrooms: 3,
      bathrooms: 2.5,
      livingAreaSqft: 1850,
      lotSizeSqft: 7841,
    });
    expect(l.sourceModifiedAt?.toISOString()).toBe("2026-09-20T15:30:00.000Z");
  });

  it("orders media, classifies floor plans and drops non-http URLs", () => {
    const l = mapOk(base);
    expect(l.media.map((m) => m.sourceKey)).toEqual(["m1", "m2", "fp"]);
    expect(l.media[0].caption).toBe("Front");
    expect(l.media[2].kind).toBe("floor_plan");
  });

  it("skips listings the seller opted out of internet display", () => {
    const r = mapResoProperty({ ...base, InternetEntireListingDisplayYN: false });
    expect(r).toEqual({ ok: false, listingKey: "abc123", reason: "not_displayable" });
  });

  it("flags suppressed addresses without dropping the listing", () => {
    expect(mapOk({ ...base, InternetAddressDisplayYN: false }).hideAddress).toBe(true);
  });

  it("rejects records without key, price or address", () => {
    expect(mapResoProperty({ ...base, ListingKey: undefined })).toMatchObject({
      reason: "missing_key",
    });
    expect(mapResoProperty({ ...base, ListPrice: 0 })).toMatchObject({ reason: "missing_price" });
    expect(mapResoProperty({ ...base, City: "" })).toMatchObject({ reason: "missing_address" });
  });

  it("rejects unsupported statuses and property types", () => {
    expect(mapResoProperty({ ...base, StandardStatus: "Incomplete" })).toMatchObject({
      reason: "unsupported_status",
    });
    expect(mapResoProperty({ ...base, PropertyType: "Mobile Home Park" })).toMatchObject({
      reason: "unsupported_property_type",
    });
  });

  it("falls back to UnparsedAddress and title-cases shouting feeds", () => {
    const l = mapOk({
      ...base,
      StreetNumber: undefined,
      StreetName: undefined,
      StreetSuffix: undefined,
      UnparsedAddress: "4501 N LAMAR BLVD, AUSTIN, TX 78751",
      City: "AUSTIN",
    });
    expect(l.addressLine1).toBe("4501 N Lamar Blvd");
    expect(l.city).toBe("Austin");
  });

  it("accepts comma-separated multi-value lookups and numeric strings", () => {
    const l = mapOk({
      ...base,
      ListPrice: "650000",
      InteriorFeatures: "Kitchen Island,WalkInClosets, None",
      Levels: ["One"],
    });
    expect(l.listPrice).toBe(650000);
    expect(l.features?.interior).toEqual(["Kitchen Island", "Walk In Closets"]);
    expect(l.isSingleStory).toBe(true);
  });

  it("derives filter booleans", () => {
    const l = mapOk({
      ...base,
      PoolFeatures: ["In Ground"],
      View: ["Hill Country"],
      Basement: ["Finished"],
    });
    expect(l.hasPool).toBe(true);
    expect(l.hasView).toBe(true);
    expect(l.hasBasement).toBe(true);
    expect(mapOk({ ...base, PoolPrivateYN: false, PoolFeatures: ["Community"] }).hasPool).toBe(
      false,
    );
  });

  it("keeps the lake in waterBodyName, apart from the subdivision", () => {
    const l = mapOk({
      ...base,
      SubdivisionName: "HARBOR POINTE",
      WaterfrontYN: true,
      WaterBodyName: "LAKE HARTWELL",
    });
    expect(l.neighborhood).toBe("Harbor Pointe");
    expect(l.waterBodyName).toBe("Lake Hartwell");
    expect(l.isWaterfront).toBe(true);
    expect(mapOk(base).waterBodyName).toBeNull();
    expect(mapOk({ ...base, WaterBodyName: "  " }).waterBodyName).toBeNull();
  });

  it("nulls out impossible coordinates", () => {
    const l = mapOk({ ...base, Latitude: 0, Longitude: 0 });
    expect(l.latitude).toBeNull();
    expect(l.longitude).toBeNull();
  });

  it("normalizes HOA frequency and ignores fees when AssociationYN is false", () => {
    expect(
      mapOk({ ...base, AssociationFee: 300, AssociationFeeFrequency: "Monthly" }),
    ).toMatchObject({
      hoaFee: 300,
      hoaFrequency: "monthly",
    });
    expect(mapOk({ ...base, AssociationYN: false, AssociationFee: 300 }).hoaFee).toBeNull();
  });

  it("keeps AssociationYN apart from an unknown HOA", () => {
    expect(mapOk({ ...base, AssociationYN: true })).toMatchObject({
      associationYN: true,
      hoaFee: null,
    });
    expect(mapOk({ ...base, AssociationYN: "N", AssociationFee: 300 })).toMatchObject({
      associationYN: false,
      hoaFee: null,
    });
    expect(mapOk({ ...base, AssociationFee: 300 })).toMatchObject({
      associationYN: true,
      hoaFee: 300,
    });
    expect(mapOk({ ...base, AssociationFee: 0 }).associationYN).toBeNull();
    expect(mapOk(base).associationYN).toBeNull();
  });

  it("maps the detail columns", () => {
    expect(
      mapOk({
        ...base,
        FireplacesTotal: 2,
        ParkingTotal: "4",
        SeniorCommunityYN: "Y",
        TaxAssessedValue: 182_400,
        LotSizeDimensions: " 100 x 200 ",
        Zoning: "R-1",
      }),
    ).toMatchObject({
      fireplacesTotal: 2,
      parkingTotal: 4,
      seniorCommunity: true,
      taxAssessedValue: 182_400,
      lotSizeDimensions: "100 x 200",
      zoning: "R-1",
    });
    expect(mapOk(base)).toMatchObject({
      fireplacesTotal: null,
      parkingTotal: null,
      seniorCommunity: null,
      taxAssessedValue: null,
      lotSizeDimensions: null,
      zoning: null,
    });
    expect(mapOk({ ...base, SeniorCommunityYN: false }).seniorCommunity).toBe(false);
    expect(mapOk({ ...base, FireplacesTotal: 0 }).fireplacesTotal).toBe(0);
    expect(mapOk({ ...base, TaxAssessedValue: 0 }).taxAssessedValue).toBeNull();
    for (const s of ["None", "N/A", "-", ""]) {
      expect(mapOk({ ...base, LotSizeDimensions: s }).lotSizeDimensions, s).toBeNull();
    }
  });

  it("maps main-level bedrooms and the primary bedroom on main", () => {
    expect(
      mapOk({ ...base, MainLevelBedrooms: 1, InteriorFeatures: ["Master On Main Level"] }),
    ).toMatchObject({ mainLevelBedrooms: 1, primaryBedroomOnMain: true });
    expect(mapOk(base)).toMatchObject({ mainLevelBedrooms: null, primaryBedroomOnMain: null });
  });

  it("maps the extra feature lists, humanized, and leaves out empty ones", () => {
    const l = mapOk({
      ...base,
      Sewer: ["SepticTank"],
      WaterSource: "Public,Well",
      Roof: ["Composition"],
      ArchitecturalStyle: ["Craftsman", "Ranch"],
      Basement: ["Finished", "Daylight"],
      PatioAndPorchFeatures: ["FrontPorch", "Screened"],
      RoadFrontageType: ["CountyRoad"],
      HorseAmenities: [],
      SpaFeatures: "None",
      Fencing: undefined,
    });
    expect(l.features).toMatchObject({
      sewer: ["Septic Tank"],
      water: ["Public", "Well"],
      roof: ["Composition"],
      style: ["Craftsman", "Ranch"],
      basement: ["Finished", "Daylight"],
      patioPorch: ["Front Porch", "Screened"],
      roadFrontage: ["County Road"],
    });
    expect(l.hasBasement).toBe(true);
    expect(l.features).not.toHaveProperty("horse");
    expect(l.features).not.toHaveProperty("spa");
    expect(l.features).not.toHaveProperty("fencing");
    // Existing keys are still always present.
    expect(mapOk(base).features).toEqual({
      interior: [],
      exterior: [],
      appliances: [],
      heating: [],
      cooling: [],
      parking: [],
      flooring: [],
      community: [],
      utilities: [],
      view: [],
      construction: [],
      lot: [],
    });
  });
});

describe("Georgia MLS (Bridge gamls2) field shapes", () => {
  // As the real dataset sends them: the standard coordinates are null on every row.
  const gamls: ResoProperty = { ...base, Latitude: null, Longitude: null };

  it("reads GAMLS2_Latitude / GAMLS2_Longitude when Latitude/Longitude are null", () => {
    const l = mapOk({ ...gamls, GAMLS2_Latitude: 34.37, GAMLS2_Longitude: -83.11 });
    expect([l.latitude, l.longitude]).toEqual([34.37, -83.11]);
  });

  it("reads Coordinates as [lng, lat]", () => {
    const l = mapOk({ ...gamls, Coordinates: [-83.11, 34.37] });
    expect([l.latitude, l.longitude]).toEqual([34.37, -83.11]);
  });

  it("prefers the standard fields when they're valid", () => {
    const l = mapOk({ ...base, GAMLS2_Latitude: 34.37, GAMLS2_Longitude: -83.11 });
    expect([l.latitude, l.longitude]).toEqual([30.2465, -97.7412]);
  });

  it("nulls out-of-range or malformed coordinates from every source", () => {
    for (const extra of [
      { GAMLS2_Latitude: 134.37, GAMLS2_Longitude: -83.11 },
      { GAMLS2_Latitude: 34.37, GAMLS2_Longitude: -283.11 },
      { Coordinates: [-83.11, 94.37] },
      { Coordinates: [0, 0] },
      { Coordinates: ["-83.11", "34.37"] },
      { Coordinates: [-83.11, 34.37, 0] },
    ]) {
      const l = mapOk({ ...gamls, ...extra });
      expect([l.latitude, l.longitude], JSON.stringify(extra)).toEqual([null, null]);
    }
  });

  it("drops placeholder subdivision names", () => {
    for (const s of ["None", "none", " NONE ", "N/A", "na", "-", "0", ""]) {
      expect(mapOk({ ...gamls, SubdivisionName: s }).neighborhood, s).toBeNull();
    }
    expect(mapOk({ ...gamls, SubdivisionName: "Harbor Pointe" }).neighborhood).toBe(
      "Harbor Pointe",
    );
  });

  it("reads 2-digit tax years as 20xx and drops impossible ones", () => {
    expect(mapOk({ ...gamls, TaxYear: 24 }).taxYear).toBe(2024);
    expect(mapOk({ ...gamls, TaxYear: "25" }).taxYear).toBe(2025);
    expect(mapOk({ ...gamls, TaxYear: 2023 }).taxYear).toBe(2023);
    expect(taxYear(2030, new Date("2026-10-26"))).toBeNull();
    expect(taxYear(2027, new Date("2026-10-26"))).toBe(2027);
    expect(taxYear(1850)).toBeNull();
    expect(taxYear(null)).toBeNull();
  });

  it("keeps the unit as sent (display formats it)", () => {
    expect(mapOk({ ...gamls, UnitNumber: "A AND B" }).unitNumber).toBe("A AND B");
  });
});

describe("commercial property", () => {
  const storefront: ResoProperty = {
    ...base,
    PropertyType: "Commercial Sale",
    PropertySubType: "Retail",
    ListPrice: 385000,
    BedroomsTotal: undefined,
    BathroomsFull: undefined,
    BathroomsHalf: undefined,
    LivingArea: 4200,
  };

  it("maps Commercial Sale to a commercial sale and keeps the subtype for display", () => {
    const l = mapOk(storefront);
    expect(l).toMatchObject({
      propertyType: "commercial",
      transactionType: "sale",
      propertySubType: "Retail",
      listPrice: 385000,
      livingAreaSqft: 4200,
      bedrooms: null,
      bathrooms: null,
    });
  });

  it("maps Business Opportunity to a commercial sale", () => {
    expect(mapPropertyType("Business Opportunity", "Restaurant")).toEqual({
      propertyType: "commercial",
      transactionType: "sale",
    });
  });

  it("never lets a commercial subtype turn the record residential", () => {
    expect(mapPropertyType("Commercial Sale", "Multi Family")).toEqual({
      propertyType: "commercial",
      transactionType: "sale",
    });
    expect(mapPropertyType("Commercial Lease", "Apartment")).toEqual({
      propertyType: "commercial",
      transactionType: "rent",
    });
  });

  it("maps Commercial Lease to a rental priced per month", () => {
    const l = mapOk({ ...storefront, PropertyType: "Commercial Lease", ListPrice: 2800 });
    expect(l).toMatchObject({
      propertyType: "commercial",
      transactionType: "rent",
      listPrice: 2800,
    });
  });

  it("converts yearly and quarterly lease amounts to monthly rent", () => {
    const lease = { ...storefront, PropertyType: "Commercial Lease", ListPrice: 14 };
    expect(
      mapOk({ ...lease, LeaseAmount: 42000, LeaseAmountFrequency: "Annually" }).listPrice,
    ).toBe(3500);
    expect(monthlyLeaseAmount({ LeaseAmount: "9000", LeaseAmountFrequency: "Quarterly" })).toBe(
      3000,
    );
    expect(monthlyLeaseAmount({ LeaseAmount: 42000, LeaseAmountFrequency: "Seasonal" })).toBeNull();
    expect(monthlyLeaseAmount({ LeaseAmountFrequency: "Monthly" })).toBeNull();
  });

  it("skips leases priced per square foot rather than showing them as monthly rent", () => {
    expect(
      mapResoProperty({ ...storefront, PropertyType: "Commercial Lease", ListPrice: 14 }),
    ).toMatchObject({ ok: false, reason: "missing_price" });
  });
});

describe("lookups", () => {
  it("maps RESO StandardStatus values", () => {
    expect(mapStatus("Active Under Contract")).toBe("active_under_contract");
    expect(mapStatus("Cancelled")).toBe("canceled");
    expect(mapStatus("Delete")).toBeNull();
  });

  it("maps leases to rentals", () => {
    expect(mapPropertyType("Residential Lease", "Condominium")).toEqual({
      propertyType: "condo",
      transactionType: "rent",
    });
  });

  it("splits and humanizes list values", () => {
    expect(list(["CeilingFans", "Ceiling Fan(s)"])).toEqual(["Ceiling Fans", "Ceiling Fan(s)"]);
    expect(list(undefined)).toEqual([]);
  });
});

// Georgia MLS IDX agreement, Exhibit C: fields that must never be displayed,
// and the ones that must be when the feed has them.
describe("Georgia MLS field rules", () => {
  const SENTINEL = "EXCLUDED-7f3a";
  const withExcluded: ResoProperty = {
    ...base,
    ListingAgreement: `Exclusive Right ${SENTINEL}`,
    ListingContractDate: "2026-01-02",
    OnMarketDate: "2026-01-03",
    ExpirationDate: "2026-12-31",
    PrivateRemarks: `Lockbox code 1234 ${SENTINEL}`,
    ShowingContactName: `Pat Showings ${SENTINEL}`,
    ShowingContactPhone: "(404) 555-0199",
    PrivateOfficeRemarks: `office only ${SENTINEL}`,
    OfficeRemarks: `office only ${SENTINEL}`,
    ShowingRequirements: `Call first ${SENTINEL}`,
    ShowingInstructions: `Call first ${SENTINEL}`,
    LockBoxType: `Supra ${SENTINEL}`,
    LockBoxLocation: `Back door ${SENTINEL}`,
    LockBoxSerialNumber: `SN ${SENTINEL}`,
    OccupantName: `Occupant ${SENTINEL}`,
    OccupantPhone: "(706) 555-0177",
    OccupantType: `Tenant ${SENTINEL}`,
    OwnerName: `Owner ${SENTINEL}`,
    OwnerPhone: "(706) 555-0188",
    AccessCode: `Gate ${SENTINEL}`,
  };

  it("never maps an excluded field, not even into another field", () => {
    for (const f of EXCLUDED_FIELDS) expect(withExcluded).toHaveProperty(f);
    const l = mapOk(withExcluded);
    const json = JSON.stringify(l);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toContain("555-0199");
    expect(json).not.toContain("555-0177");
    expect(json).not.toContain("555-0188");
    // The contract and on-market dates no longer feed the list date.
    expect(json).not.toContain("2026-01-02");
    expect(json).not.toContain("2026-01-03");
    expect(json).not.toContain("2026-12-31");
    expect(l.listDate).toBeNull();
  });

  it("never puts an excluded field into the feature lists", () => {
    const l = mapOk({
      ...withExcluded,
      BuyerAgencyCompensation: `3% ${SENTINEL}`,
      CompensationComments: `comments ${SENTINEL}`,
      SecurityFeatures: ["Smoke Detector(s)"],
    });
    const keys = Object.keys(l.features ?? {});
    expect(keys).toContain("security");
    for (const k of keys) expect(isExcludedField(k), k).toBe(false);
    expect(JSON.stringify(l.features)).not.toContain(SENTINEL);
  });

  it("dates the listing by OriginalEntryTimestamp", () => {
    expect(
      mapOk({ ...withExcluded, OriginalEntryTimestamp: "2026-02-10T14:00:00Z" }).listDate,
    ).toBe("2026-02-10");
  });

  it("maps On Hold like Withdrawn", () => {
    expect(mapStatus("On Hold")).toBe("withdrawn");
    expect(mapStatus("Hold")).toBe("withdrawn");
  });

  it("reads the attribution contact from separate fields, with vendor prefixes", () => {
    expect(
      attribution({
        GAMLS_AttributionContactPhone: "706-555-0100",
        GAMLS_AttributionContactEmail: "office@example.com",
      }),
    ).toEqual({ attributionPhone: "706-555-0100", attributionEmail: "office@example.com" });
    expect(mapOk({ ...base, AttributionContactPhone: "(706) 555-0101" }).attributionPhone).toBe(
      "(706) 555-0101",
    );
  });

  it("picks the phone and email out of RESO's free-text AttributionContact", () => {
    expect(
      attribution({ AttributionContact: "Jane Broker, (770) 555-0142, jane@brokerage.com" }),
    ).toEqual({ attributionPhone: "(770) 555-0142", attributionEmail: "jane@brokerage.com" });
    expect(attribution({})).toEqual({ attributionPhone: null, attributionEmail: null });
  });

  it("keeps Variable Compensation when the feed sends it, and only then", () => {
    expect(compensation({ DualVariableCompensationYN: true }).variableCompensation).toBe(true);
    expect(compensation({ DualVariableCompensationYN: "N" }).variableCompensation).toBe(false);
    expect(compensation({}).variableCompensation).toBeNull();
  });

  it("keeps compensation comments only with a buyer-agency compensation", () => {
    expect(
      compensation({
        BuyerAgencyCompensation: "2.5",
        BuyerAgencyCompensationType: "%",
        CompensationComments: "Less $500 admin fee",
      }),
    ).toMatchObject({
      buyerAgencyCompensation: "2.5 %",
      compensationComments: "Less $500 admin fee",
    });
    expect(compensation({ CompensationComments: "orphan comment" })).toMatchObject({
      buyerAgencyCompensation: null,
      compensationComments: null,
    });
  });
});

describe("mainLevelBedroomFacts", () => {
  const facts = (p: ResoProperty) => mainLevelBedroomFacts({ BedroomsTotal: 4, ...p });
  const MASTER = { InteriorFeatures: ["High Ceilings", "Master On Main Level"] };

  it("trusts the InteriorFeatures flag", () => {
    expect(facts({ ...MASTER, MainLevelBedrooms: 1 })).toEqual({
      mainLevelBedrooms: 1,
      primaryBedroomOnMain: true,
    });
    // Comma-separated, and with no MainLevelBedrooms.
    expect(facts({ InteriorFeatures: "Walk-In Closet(s), Master On Main Level" })).toEqual({
      mainLevelBedrooms: null,
      primaryBedroomOnMain: true,
    });
  });

  it("matches only the feed's exact value, case-insensitively", () => {
    for (const v of ["Master On Main Level", "master on main level", "MASTER ON MAIN LEVEL"]) {
      expect(facts({ InteriorFeatures: [v] }).primaryBedroomOnMain, v).toBe(true);
    }
    for (const v of [
      "Primary On Main",
      "Master Bedroom On Main Level",
      "Master On Main",
      "Master on Main Floor",
      "Main Level Master",
      "Owner's Suite on Main",
      " Master On Main Level",
      "Master Downstairs",
      "Guest On Main",
      "Master On Main Level Plus",
    ]) {
      expect(facts({ InteriorFeatures: [v] }).primaryBedroomOnMain, v).toBeNull();
    }
  });

  it("calls the flag with no main-level bedroom a conflict (unknown)", () => {
    expect(facts({ ...MASTER, MainLevelBedrooms: 0 })).toEqual({
      mainLevelBedrooms: 0,
      primaryBedroomOnMain: null,
    });
  });

  it("is yes when every bedroom is on the main level", () => {
    expect(facts({ MainLevelBedrooms: 4 })).toEqual({
      mainLevelBedrooms: 4,
      primaryBedroomOnMain: true,
    });
    expect(facts({ MainLevelBedrooms: "4" }).primaryBedroomOnMain).toBe(true);
  });

  it("is no when no bedroom is on the main level", () => {
    expect(facts({ MainLevelBedrooms: 0 })).toEqual({
      mainLevelBedrooms: 0,
      primaryBedroomOnMain: false,
    });
  });

  it("is unknown for some bedrooms on main and no flag", () => {
    expect(facts({ MainLevelBedrooms: 2 })).toEqual({
      mainLevelBedrooms: 2,
      primaryBedroomOnMain: null,
    });
  });

  it("is unknown without the field", () => {
    expect(facts({})).toEqual({ mainLevelBedrooms: null, primaryBedroomOnMain: null });
    expect(facts({ MainLevelBedrooms: null })).toEqual({
      mainLevelBedrooms: null,
      primaryBedroomOnMain: null,
    });
  });

  it("drops a count above BedroomsTotal, negative or fractional", () => {
    for (const v of [5, -1, 1.5, "abc"]) {
      expect(facts({ MainLevelBedrooms: v }), String(v)).toEqual({
        mainLevelBedrooms: null,
        primaryBedroomOnMain: null,
      });
    }
  });

  const REJECTED: unknown[] = [
    "2.0",
    "0x2",
    "1e0",
    " 2 ",
    "-1",
    "+2",
    "",
    2.6,
    -1,
    NaN,
    Infinity,
    true,
  ];

  it("rejects a MainLevelBedrooms that isn't a strict non-negative integer", () => {
    for (const v of REJECTED) {
      expect(facts({ MainLevelBedrooms: v }).mainLevelBedrooms, String(v)).toBeNull();
    }
  });

  it("rejects a BedroomsTotal that isn't a strict non-negative integer", () => {
    for (const v of REJECTED) {
      expect(mainLevelBedroomFacts({ BedroomsTotal: v, MainLevelBedrooms: 2 }), String(v)).toEqual({
        mainLevelBedrooms: null,
        primaryBedroomOnMain: null,
      });
    }
  });

  it("accepts a digit string or an integer for both fields", () => {
    for (const total of [3, "3"]) {
      for (const mlb of [3, "3"]) {
        expect(
          mainLevelBedroomFacts({ BedroomsTotal: total, MainLevelBedrooms: mlb }),
          `${typeof total}/${typeof mlb}`,
        ).toEqual({ mainLevelBedrooms: 3, primaryBedroomOnMain: true });
      }
    }
  });

  it("is unknown when BedroomsTotal is missing or invalid", () => {
    for (const total of [undefined, "abc", 2.6]) {
      for (const mlb of [99, 2]) {
        expect(
          mainLevelBedroomFacts({ BedroomsTotal: total, MainLevelBedrooms: mlb }),
          `${String(total)}/${mlb}`,
        ).toEqual({ mainLevelBedrooms: null, primaryBedroomOnMain: null });
      }
    }
  });

  it("leaves the primary bedroom unknown with no bedrooms at all", () => {
    expect(mainLevelBedroomFacts({ BedroomsTotal: 0, MainLevelBedrooms: 0 })).toEqual({
      mainLevelBedrooms: 0,
      primaryBedroomOnMain: null,
    });
    expect(mainLevelBedroomFacts({ BedroomsTotal: 0, ...MASTER })).toEqual({
      mainLevelBedrooms: null,
      primaryBedroomOnMain: null,
    });
  });
});

describe("main_level_bedrooms migration", () => {
  it("only adds columns and indexes: the v4 remap fills them, not an UPDATE", () => {
    const dir = fileURLToPath(new URL("../../../../drizzle/", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith("_main_level_bedrooms.sql"));
    expect(files).toHaveLength(1);
    const migration = readFileSync(join(dir, files[0]), "utf8");
    expect(migration).not.toMatch(/\bUPDATE\b/i);
    expect(migration.trimEnd()).not.toMatch(/statement-breakpoint$/);
  });
});
