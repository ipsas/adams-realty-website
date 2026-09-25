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
  const pmi = a.downPaymentPct < 20 ? (loanAmount * 0.005) / 12 : 0;
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

export function monthlyHoaAmount(
  fee: number | null | undefined,
  frequency: string | null | undefined,
): number {
  if (!fee) return 0;
  if (frequency === "quarterly") return fee / 3;
  if (frequency === "annually") return fee / 12;
  return fee;
}
