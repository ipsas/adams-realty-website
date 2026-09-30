import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import {
  estimateMonthlyCost,
  financeFor,
  type FinanceDefaults,
  listingMonthlyCost,
  monthlyCostModel,
  monthlyHoaAmount,
  quickMonthlyCost,
} from "./mortgage";

/** The listing page's full estimate, with the site's finance defaults. */
function fullEstimate(
  l: {
    price: number;
    annualTax: number | null;
    hoaFee: number | null;
    hoaFrequency: string | null;
  },
  f: FinanceDefaults = site.finance,
) {
  return estimateMonthlyCost({
    price: l.price,
    downPaymentPct: f.downPaymentPct,
    interestRatePct: f.interestRate,
    loanTermYears: f.loanTermYears,
    annualTax: l.annualTax || (l.price * f.propertyTaxRatePct) / 100,
    annualInsurance: (l.price * f.insuranceRatePct) / 100,
    monthlyHoa: monthlyHoaAmount(l.hoaFee, l.hoaFrequency),
  }).total;
}

const FIXTURES = [
  { price: 425_000, annualTax: 4_870, hoaFee: null, hoaFrequency: null },
  { price: 289_900, annualTax: null, hoaFee: 900, hoaFrequency: "quarterly" },
  { price: 1_250_000, annualTax: 14_200, hoaFee: 2_400, hoaFrequency: "annually" },
];

describe("quickMonthlyCost", () => {
  it.each(FIXTURES)("matches estimateMonthlyCost within $1 for $price", (l) => {
    expect(Math.abs(quickMonthlyCost(l)! - fullEstimate(l))).toBeLessThan(1);
  });

  it("includes PMI below 20% down with a custom model", () => {
    const finance = { ...site.finance, downPaymentPct: 5 };
    const model = monthlyCostModel(finance);
    expect(model.pmiRateMonthly).toBeGreaterThan(0);
    for (const l of FIXTURES) {
      expect(Math.abs(quickMonthlyCost(l, model)! - fullEstimate(l, finance))).toBeLessThan(1);
    }
  });

  it("treats a zero tax figure as missing, like the payment calculator", () => {
    const base = { price: 400_000, hoaFee: null, hoaFrequency: null };
    expect(quickMonthlyCost({ ...base, annualTax: 0 })).toBe(
      quickMonthlyCost({ ...base, annualTax: null }),
    );
  });

  it("returns null without a price", () => {
    expect(quickMonthlyCost({ price: 0 })).toBeNull();
    expect(quickMonthlyCost({ price: null })).toBeNull();
  });
});

describe("monthlyCostModel", () => {
  it("has no PMI at 20% down and scales linearly with price", () => {
    const m = monthlyCostModel();
    expect(m.pmiRateMonthly).toBe(0);
    expect(m.insuranceRateMonthly).toBeCloseTo(site.finance.insuranceRatePct / 1200, 10);
    expect(m.taxFallbackRateMonthly).toBeCloseTo(site.finance.propertyTaxRatePct / 1200, 10);
    const a = quickMonthlyCost({ price: 300_000 })!;
    const b = quickMonthlyCost({ price: 600_000 })!;
    expect(b).toBeCloseTo(a * 2, 6);
  });
});

describe("financeFor (regional insurance and tax fallbacks)", () => {
  const royston = financeFor("Franklin");
  const savannah = financeFor("Chatham");
  const atlanta = financeFor("Fulton");
  const brunswick = financeFor("Glynn County");

  it("keeps the statewide defaults in the firm's counties", () => {
    for (const county of site.market.counties) {
      const f = financeFor(county);
      expect(f.insuranceRatePct, county).toBe(site.finance.insuranceRatePct);
      expect(f.propertyTaxRatePct, county).toBe(site.finance.propertyTaxRatePct);
    }
    expect(royston).toEqual({
      interestRate: site.finance.interestRate,
      downPaymentPct: site.finance.downPaymentPct,
      loanTermYears: site.finance.loanTermYears,
      insuranceRatePct: 0.6,
      propertyTaxRatePct: 0.9,
    });
  });

  it("charges coastal insurance in Savannah and Brunswick, not Royston", () => {
    expect(savannah.insuranceRatePct).toBe(1.2);
    expect(brunswick.insuranceRatePct).toBe(1.2);
    expect(atlanta.insuranceRatePct).toBe(royston.insuranceRatePct);
  });

  it("uses the metro tax fallback in Atlanta and Savannah, not Royston or Brunswick", () => {
    expect(atlanta.propertyTaxRatePct).toBe(1.1);
    expect(savannah.propertyTaxRatePct).toBe(1.1);
    expect(brunswick.propertyTaxRatePct).toBe(royston.propertyTaxRatePct);
  });

  it("makes the same untaxed home cost more a month in Savannah than in Royston", () => {
    const home = { price: 350_000, annualTax: null, hoaFee: null, hoaFrequency: null };
    expect(fullEstimate(home, savannah)).toBeGreaterThan(fullEstimate(home, royston) + 150);
  });

  it("matches county names regardless of case and a 'County' suffix", () => {
    expect(financeFor("CHATHAM")).toEqual(savannah);
    expect(financeFor("chatham county")).toEqual(savannah);
    expect(financeFor("DeKalb County").propertyTaxRatePct).toBe(1.1);
  });

  it("falls back to the statewide defaults for unknown or missing counties", () => {
    expect(financeFor(null)).toEqual(royston);
    expect(financeFor(undefined)).toEqual(royston);
    expect(financeFor("Atlantis")).toEqual(royston);
  });
});

describe("listingMonthlyCost (the listing page's estimate and the calculator's start)", () => {
  const f: FinanceDefaults = {
    interestRate: 6,
    downPaymentPct: 10,
    loanTermYears: 30,
    insuranceRatePct: 0.5,
    propertyTaxRatePct: 1,
  };
  // $200,000 at 10% down: a $180,000 loan at 6% over 30 years is $1,079.19 a month.
  const pAndI = 1_079.19;

  it("charges bare land no home insurance and no mortgage insurance", () => {
    const land = listingMonthlyCost({
      price: 200_000,
      annualTax: 1_200,
      monthlyHoa: 0,
      finance: f,
      land: true,
    });
    expect(land.insurance).toBe(0);
    expect(land.pmi).toBe(0);
    expect(land.taxes).toBe(100);
    expect(land.total).toBeCloseTo(pAndI + 100, 1);
  });

  it("charges a house the county's insurance and, below 20% down, mortgage insurance", () => {
    const house = listingMonthlyCost({
      price: 200_000,
      annualTax: 1_200,
      monthlyHoa: 50,
      finance: f,
      land: false,
    });
    // 0.5% of $200,000 a year; PMI 0.5% of the $180,000 loan a year.
    expect(house.insurance).toBeCloseTo(1_000 / 12, 6);
    expect(house.pmi).toBeCloseTo(900 / 12, 6);
    expect(house.total).toBeCloseTo(pAndI + 100 + 1_000 / 12 + 50 + 75, 1);
  });

  it("uses the county's tax rate when the listing has none, and scales the listed tax with price", () => {
    const untaxed = listingMonthlyCost({
      price: 200_000,
      annualTax: null,
      monthlyHoa: 0,
      finance: f,
      land: true,
    });
    expect(untaxed.taxes).toBeCloseTo(2_000 / 12, 6);
    const explored = listingMonthlyCost({
      price: 200_000,
      annualTax: 1_200,
      monthlyHoa: 0,
      finance: f,
      land: true,
      homePrice: 100_000,
      downPaymentPct: 20,
    });
    expect(explored.taxes).toBe(50);
    expect(explored.loanAmount).toBe(80_000);
  });
});
