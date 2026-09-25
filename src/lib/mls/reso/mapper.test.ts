import { describe, expect, it } from "vitest";
import { list, mapPropertyType, mapResoProperty, mapStatus, type ResoProperty } from "./mapper";

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
    expect(mapResoProperty({ ...base, PropertyType: "Commercial Sale" })).toMatchObject({
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
