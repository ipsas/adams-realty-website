import { describe, expect, it } from "vitest";
import { estimateMonthlyCost } from "@/lib/mortgage";
import {
  acresOf,
  formatAcres,
  formatPricePerAcre,
  isBareLand,
  isLandType,
  landFacts,
  landSummary,
  lotSizeInUnit,
  lotSizeToSqft,
  pricePerAcre,
  SQFT_PER_ACRE,
} from "./land";

describe("land and farms (site review #8)", () => {
  it("calls land and farms with no house bare land, and nothing with a house", () => {
    expect(isLandType("land")).toBe(true);
    expect(isLandType("farm_ranch")).toBe(true);
    expect(isLandType("single_family")).toBe(false);
    expect(isBareLand({ propertyType: "land", livingAreaSqft: null, bedrooms: null })).toBe(true);
    expect(isBareLand({ propertyType: "farm_ranch", livingAreaSqft: 0, bedrooms: 0 })).toBe(true);
    // A farm with a farmhouse is a home too.
    expect(isBareLand({ propertyType: "farm_ranch", livingAreaSqft: 1800, bedrooms: 3 })).toBe(
      false,
    );
    expect(isBareLand({ propertyType: "land", livingAreaSqft: null, bedrooms: 2 })).toBe(false);
    expect(isBareLand({ propertyType: "single_family", livingAreaSqft: null })).toBe(false);
  });

  it("formats acres for how land is listed", () => {
    expect(formatAcres(166 * SQFT_PER_ACRE + 1000)).toBe("166 acres");
    expect(formatAcres(12.5 * SQFT_PER_ACRE)).toBe("12.5 acres");
    expect(formatAcres(0.52 * SQFT_PER_ACRE)).toBe("0.52 acres");
    expect(formatAcres(SQFT_PER_ACRE)).toBe("1 acre");
    expect(formatAcres(40 * SQFT_PER_ACRE)).toBe("40 acres");
    expect(formatAcres(100)).toBe("under 0.01 acres");
    expect(formatAcres(null)).toBe("—");
    expect(formatAcres(0)).toBe("—");
    expect(acresOf(2 * SQFT_PER_ACRE)).toBe(2);
    expect(acresOf(null)).toBeNull();
  });

  it("works out the price per acre, or nothing without a price or a lot size", () => {
    expect(pricePerAcre(1_000_000, 166 * SQFT_PER_ACRE)).toBe(6024);
    expect(formatPricePerAcre(420_000, 50 * SQFT_PER_ACRE)).toBe("$8,400/acre");
    expect(pricePerAcre(420_000, null)).toBeNull();
    expect(pricePerAcre(0, SQFT_PER_ACRE)).toBeNull();
    expect(formatPricePerAcre(null, SQFT_PER_ACRE)).toBeNull();
  });

  it("describes bare land in one line: 'Land · X acres · $Y/acre'", () => {
    const tract = { propertyType: "land", lotSizeSqft: 50 * SQFT_PER_ACRE };
    expect(landFacts(tract)).toBe("Land · 50 acres");
    expect(landSummary({ ...tract, price: 420_000 })).toBe("Land · 50 acres · $8,400/acre");
    expect(landSummary({ ...tract, price: null })).toBe("Land · 50 acres");
    expect(landSummary({ propertyType: "land", lotSizeSqft: null, price: 90_000 })).toBe("Land");
    expect(landSummary({ propertyType: "farm_ranch", lotSizeSqft: 40 * SQFT_PER_ACRE })).toBe(
      "Farm · 40 acres",
    );
    expect(
      landSummary({ propertyType: "single_family", livingAreaSqft: 1800, lotSizeSqft: 43_560 }),
    ).toBeNull();
  });

  it("converts the dashboard's lot size from acres or square feet", () => {
    expect(lotSizeToSqft(2.5, "acres")).toBe(108_900);
    expect(lotSizeToSqft(0.25, "acres")).toBe(10_890);
    expect(lotSizeToSqft(9_800, "sqft")).toBe(9_800);
    expect(lotSizeToSqft(null, "acres")).toBeNull();
    expect(lotSizeToSqft(undefined, "sqft")).toBeNull();
    expect(lotSizeToSqft(-1, "acres")).toBeNull();
    expect(lotSizeToSqft(Number.NaN, "acres")).toBeNull();
  });

  it("shows a stored lot size in either unit, and switching back gives the same square feet", () => {
    expect(lotSizeInUnit(108_900, "acres")).toBe("2.5");
    expect(lotSizeInUnit(108_900, "sqft")).toBe("108900");
    expect(lotSizeInUnit(null, "acres")).toBe("");
    for (const sqft of [1, 9_999, 10_000, 43_561, 7_230_960, 99_999_999]) {
      expect(lotSizeToSqft(Number(lotSizeInUnit(sqft, "acres")), "acres")).toBe(sqft);
    }
  });

  it("estimates bare land with no home or mortgage insurance", () => {
    const base = {
      price: 300_000,
      downPaymentPct: 10,
      interestRatePct: 6.25,
      loanTermYears: 30,
      annualTax: 1_200,
      monthlyHoa: 0,
    };
    const house = estimateMonthlyCost({ ...base, annualInsurance: 1_800 });
    const land = estimateMonthlyCost({ ...base, annualInsurance: 0, noMortgageInsurance: true });
    expect(house.insurance).toBe(150);
    expect(house.pmi).toBeGreaterThan(0);
    expect(land.insurance).toBe(0);
    expect(land.pmi).toBe(0);
    expect(land.total).toBeCloseTo(land.principalAndInterest + land.taxes, 6);
  });
});
