import { describe, expect, it } from "vitest";
import { site } from "@/config/site";
import {
  estimateMonthlyCost,
  type FinanceDefaults,
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
