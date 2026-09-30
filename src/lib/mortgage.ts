import { site } from "@/config/site";

/** Monthly principal & interest for a fixed-rate loan. */
export function monthlyPrincipalAndInterest(
  principal: number,
  annualRatePct: number,
  years: number,
): number {
  if (principal <= 0) return 0;
  const n = years * 12;
  const r = annualRatePct / 100 / 12;
  if (r === 0) return principal / n;
  return (principal * r) / (1 - Math.pow(1 + r, -n));
}

export type CostAssumptions = {
  price: number;
  downPaymentPct: number;
  interestRatePct: number;
  loanTermYears: number;
  /** Annual property tax in dollars. */
  annualTax: number;
  /** Annual insurance in dollars. */
  annualInsurance: number;
  /** Monthly HOA in dollars. */
  monthlyHoa: number;
  /**
   * Bare land (site review #8): private mortgage insurance belongs to home mortgages,
   * and a land loan carries none. Callers pass 0 insurance too: there's no house.
   */
  noMortgageInsurance?: boolean;
};

export type MonthlyCost = {
  principalAndInterest: number;
  taxes: number;
  insurance: number;
  hoa: number;
  /** Private mortgage insurance, estimated at 0.5%/yr of the loan when < 20% down. */
  pmi: number;
  total: number;
  loanAmount: number;
};

/**
 * The honest monthly number — portals often show principal & interest only.
 * Taxes, insurance, HOA and PMI are what actually land in a buyer's budget.
 */
export function estimateMonthlyCost(a: CostAssumptions): MonthlyCost {
  const loanAmount = Math.max(0, a.price * (1 - a.downPaymentPct / 100));
  const principalAndInterest = monthlyPrincipalAndInterest(
    loanAmount,
    a.interestRatePct,
    a.loanTermYears,
  );
  const taxes = a.annualTax / 12;
  const insurance = a.annualInsurance / 12;
  const pmi = !a.noMortgageInsurance && a.downPaymentPct < 20 ? (loanAmount * 0.005) / 12 : 0;
  const hoa = a.monthlyHoa;
  return {
    principalAndInterest,
    taxes,
    insurance,
    hoa,
    pmi,
    total: principalAndInterest + taxes + insurance + hoa + pmi,
    loanAmount,
  };
}

/**
 * A listing's full monthly estimate: the listing page's "Est. monthly cost" and the
 * payment calculator's starting figure are both this, so they can't drift apart. Taxes
 * are the listing's figure (scaled to `homePrice` when the buyer explores another
 * price), else the county's typical rate; insurance is the county's typical rate.
 * Bare land (`land`, site review #8) has no house to insure and no mortgage insurance.
 * The loan terms default to `finance`; the calculator passes the buyer's own.
 */
export function listingMonthlyCost(a: {
  price: number;
  annualTax: number | null;
  monthlyHoa: number;
  finance: FinanceDefaults;
  land: boolean;
  homePrice?: number;
  downPaymentPct?: number;
  interestRatePct?: number;
  loanTermYears?: number;
}): MonthlyCost {
  const f = a.finance;
  const price = a.homePrice ?? a.price;
  return estimateMonthlyCost({
    price,
    downPaymentPct: a.downPaymentPct ?? f.downPaymentPct,
    interestRatePct: a.interestRatePct ?? f.interestRate,
    loanTermYears: a.loanTermYears ?? f.loanTermYears,
    annualTax:
      a.annualTax && a.price > 0
        ? a.annualTax * (price / a.price)
        : (price * f.propertyTaxRatePct) / 100,
    annualInsurance: a.land ? 0 : (price * f.insuranceRatePct) / 100,
    monthlyHoa: a.monthlyHoa,
    noMortgageInsurance: a.land,
  });
}

export function monthlyHoaAmount(
  fee: number | null | undefined,
  frequency: string | null | undefined,
): number {
  if (!fee) return 0;
  if (frequency === "quarterly") return fee / 3;
  if (frequency === "annually") return fee / 12;
  return fee;
}

/** The subset of `site.finance` the cost model needs. */
export type FinanceDefaults = {
  interestRate: number;
  downPaymentPct: number;
  loanTermYears: number;
  insuranceRatePct: number;
  propertyTaxRatePct: number;
};

const countyKey = (county: string) =>
  county
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/ county$/, "");

/**
 * The finance defaults for a listing's county: the statewide defaults with
 * `site.finance.regions`' insurance and tax fallbacks applied (a Savannah home
 * gets coastal insurance, an Atlanta home the metro tax fallback). Unknown or
 * missing counties get the statewide defaults. "Chatham County" and "CHATHAM"
 * both match "Chatham".
 */
export function financeFor(
  county: string | null | undefined,
  finance: FinanceDefaults & {
    regions: readonly {
      counties: readonly string[];
      insuranceRatePct?: number;
      propertyTaxRatePct?: number;
    }[];
  } = site.finance,
): FinanceDefaults {
  const out: FinanceDefaults = {
    interestRate: finance.interestRate,
    downPaymentPct: finance.downPaymentPct,
    loanTermYears: finance.loanTermYears,
    insuranceRatePct: finance.insuranceRatePct,
    propertyTaxRatePct: finance.propertyTaxRatePct,
  };
  if (!county) return out;
  const key = countyKey(county);
  for (const r of finance.regions) {
    if (!r.counties.some((c) => countyKey(c) === key)) continue;
    if (r.insuranceRatePct !== undefined) out.insuranceRatePct = r.insuranceRatePct;
    if (r.propertyTaxRatePct !== undefined) out.propertyTaxRatePct = r.propertyTaxRatePct;
  }
  return out;
}

/**
 * Linear coefficients of the all-in monthly cost, per dollar of price, under
 * fixed finance defaults. Monthly cost = price × (piPerDollar +
 * insuranceRateMonthly + pmiRateMonthly) + tax + HOA, where tax falls back to
 * price × taxFallbackRateMonthly. Cards, pins and (later) the SQL maxMonthly
 * filter all use these numbers so they agree to the dollar.
 */
export type MonthlyCostModel = {
  /** Principal & interest per dollar of price (the down payment is already applied). */
  piPerDollar: number;
  insuranceRateMonthly: number;
  /** Used when a listing has no tax figure. */
  taxFallbackRateMonthly: number;
  /** PMI per dollar of price; 0 at 20% down or more. */
  pmiRateMonthly: number;
};

export function monthlyCostModel(finance: FinanceDefaults = site.finance): MonthlyCostModel {
  const loanPerDollar = Math.max(0, 1 - finance.downPaymentPct / 100);
  return {
    piPerDollar: monthlyPrincipalAndInterest(
      loanPerDollar,
      finance.interestRate,
      finance.loanTermYears,
    ),
    insuranceRateMonthly: finance.insuranceRatePct / 100 / 12,
    taxFallbackRateMonthly: finance.propertyTaxRatePct / 100 / 12,
    // Same rule as estimateMonthlyCost: 0.5%/yr of the loan below 20% down.
    pmiRateMonthly: finance.downPaymentPct < 20 ? (loanPerDollar * 0.005) / 12 : 0,
  };
}

const defaultModel = monthlyCostModel();

/**
 * All-in monthly cost of buying a for-sale listing with site finance defaults
 * (unrounded; format with formatMonthly). Callers skip rentals and sold homes.
 * Matches estimateMonthlyCost; like the payment calculator, a missing or zero
 * tax figure uses the fallback rate. Null without a price.
 */
export function quickMonthlyCost(
  listing: {
    price: number | null | undefined;
    annualTax?: number | null;
    hoaFee?: number | null;
    hoaFrequency?: string | null;
  },
  model: MonthlyCostModel = defaultModel,
): number | null {
  const { price } = listing;
  if (!price || price <= 0) return null;
  const tax =
    listing.annualTax && listing.annualTax > 0
      ? listing.annualTax / 12
      : price * model.taxFallbackRateMonthly;
  return (
    price * (model.piPerDollar + model.insuranceRateMonthly + model.pmiRateMonthly) +
    tax +
    monthlyHoaAmount(listing.hoaFee, listing.hoaFrequency)
  );
}
