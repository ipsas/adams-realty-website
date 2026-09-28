import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import { firmAreaCondition, isFirmArea, offersTours } from "./firm-area";

const at = (city: string, county: string | null, over: Record<string, string | null> = {}) => ({
  city,
  county,
  neighborhood: null,
  waterBodyName: null,
  ...over,
});

describe("isFirmArea", () => {
  it("is true in every county the firm serves", () => {
    expect(isFirmArea(at("Royston", "Franklin"))).toBe(true);
    for (const county of site.market.counties) {
      expect(isFirmArea(at("Anywhere", county)), county).toBe(true);
    }
  });

  it("accepts the feed's county spellings", () => {
    expect(isFirmArea(at("Hartwell", "Hart County"))).toBe(true);
    expect(isFirmArea(at("Toccoa", "STEPHENS"))).toBe(true);
  });

  it("is true for an area guide inside the guide's own counties", () => {
    // Lake Lanier's guide reaches into Forsyth County, which isn't a firm county.
    expect(isFirmArea(at("Cumming", "Forsyth", { neighborhood: "Lake Lanier" }))).toBe(true);
    // Real feeds put the subdivision in neighborhood and the lake in WaterBodyName.
    expect(
      isFirmArea(
        at("Cumming", "Forsyth", {
          neighborhood: "Harbour Point",
          waterBodyName: "Lake Sidney Lanier",
        }),
      ),
    ).toBe(true);
    // Braselton spreads into Barrow County.
    expect(isFirmArea(at("Braselton", "Barrow"))).toBe(true);
  });

  it("is false for the rest of Georgia", () => {
    expect(isFirmArea(at("Savannah", "Chatham"))).toBe(false);
    expect(isFirmArea(at("Atlanta", "Fulton", { neighborhood: "Virginia-Highland" }))).toBe(false);
    expect(isFirmArea(at("Valdosta", "Lowndes"))).toBe(false);
    // A Forsyth County home that isn't on Lake Lanier is outside.
    expect(isFirmArea(at("Cumming", "Forsyth"))).toBe(false);
  });

  it("never matches by name alone across counties", () => {
    // A subdivision named Jefferson in Chatham County is not Jefferson, Jackson County.
    expect(isFirmArea(at("Savannah", "Chatham", { neighborhood: "Jefferson" }))).toBe(false);
    expect(isFirmArea(at("Commerce", "Chatham"))).toBe(false);
  });

  it("is false without a county, even for a firm town's name", () => {
    expect(isFirmArea(at("Savannah", null))).toBe(false);
    expect(isFirmArea(at("Royston", null))).toBe(false);
  });
});

describe("offersTours", () => {
  it("offers tours on the firm's own listings anywhere, and in its area", () => {
    expect(offersTours({ ...at("Savannah", "Chatham"), isCompanyListing: true })).toBe(true);
    expect(offersTours({ ...at("Royston", "Franklin"), isCompanyListing: false })).toBe(true);
    expect(offersTours({ ...at("Savannah", "Chatham"), isCompanyListing: false })).toBe(false);
  });
});

describe("firmAreaCondition", () => {
  const { sql, params } = new PgDialect().sqlToQuery(firmAreaCondition());

  it("requires a county and checks the firm's counties", () => {
    expect(sql).toMatch(/^\("listings"\."county" is not null and/);
    for (const c of site.market.counties) expect(params).toContain(c.toLowerCase());
  });

  it("also admits each area guide, county-scoped", () => {
    expect(params).toContain("lake lanier");
    expect(params).toContain("forsyth");
    expect(sql).toContain('"listings"."water_body"');
  });
});
