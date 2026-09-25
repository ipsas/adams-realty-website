import { describe, expect, it } from "vitest";
import { daysSince, formatBaths, formatLot, formatPriceShort, formatStreet } from "./format";
import { estimateMonthlyCost, monthlyHoaAmount, monthlyPrincipalAndInterest } from "./mortgage";

describe("format", () => {
  it("formats compact prices for map pins", () => {
    expect(formatPriceShort(725_000)).toBe("$725K");
    expect(formatPriceShort(1_250_000)).toBe("$1.25M");
    expect(formatPriceShort(1_000_000)).toBe("$1M");
    expect(formatPriceShort(12_500_000)).toBe("$12.5M");
    expect(formatPriceShort(2_450)).toBe("$2K");
  });

  it("formats baths and lots", () => {
    expect(formatBaths(2.5)).toBe("2.5");
    expect(formatBaths(3)).toBe("3");
    expect(formatLot(7_841)).toBe("7,841 sqft lot");
    expect(formatLot(43_560)).toBe("1 acres");
    expect(formatLot(65_340)).toBe("1.5 acres");
  });

  it("respects suppressed addresses", () => {
    const a = { addressLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" };
    expect(formatStreet({ ...a, unitNumber: "4B" })).toBe("1 Main St #4B");
    expect(formatStreet({ ...a, hideAddress: true })).toBe("Address withheld by seller");
  });

  it("counts days on market", () => {
    expect(daysSince("2026-09-20", new Date("2026-09-25T15:00:00Z"))).toBe(5);
    expect(daysSince("2026-09-30", new Date("2026-09-25T15:00:00Z"))).toBeLessThan(0);
  });
});

describe("mortgage", () => {
  it("matches the standard amortization formula", () => {
    // $400k at 6% for 30 years ≈ $2,398.20/mo
    expect(monthlyPrincipalAndInterest(400_000, 6, 30)).toBeCloseTo(2398.2, 1);
    expect(monthlyPrincipalAndInterest(360_000, 0, 30)).toBe(1000);
  });

  it("includes taxes, insurance, HOA, and PMI below 20% down", () => {
    const cost = estimateMonthlyCost({
      price: 500_000,
      downPaymentPct: 10,
      interestRatePct: 6,
      loanTermYears: 30,
      annualTax: 9_600,
      annualInsurance: 2_400,
      monthlyHoa: 50,
    });
    expect(cost.loanAmount).toBe(450_000);
    expect(cost.taxes).toBe(800);
    expect(cost.insurance).toBe(200);
    expect(cost.pmi).toBeCloseTo(187.5);
    expect(cost.total).toBeCloseTo(cost.principalAndInterest + 800 + 200 + 50 + 187.5);
  });

  it("normalizes HOA frequency to monthly", () => {
    expect(monthlyHoaAmount(300, "quarterly")).toBe(100);
    expect(monthlyHoaAmount(1200, "annually")).toBe(100);
    expect(monthlyHoaAmount(null, "monthly")).toBe(0);
  });
});
