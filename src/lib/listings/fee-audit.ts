/**
 * The per-row rules of `npm run check:fees` (scripts/check-fees.ts), pure so they are
 * unit-tested (fee-audit.test.ts). Each stored feed fee row gets the labels of the
 * problems it has; an empty list means the row is fine.
 */
import { GAMLS_SLUG } from "@/lib/mls/gamls";
import { isHoaFrequency, monthlyHoaEquivalent } from "./hoa-fee";

export const UNKNOWN_KEY = "frequency not a RESO FeeFrequency key";
export const GAMLS_NOT_ANNUAL = "Georgia MLS fee not stored as annually";
export const SQL_JS_DRIFT = "SQL monthly equivalent differs from JS";

/** Every label, in report order. */
export const FEE_PROBLEMS = [UNKNOWN_KEY, GAMLS_NOT_ANNUAL, SQL_JS_DRIFT] as const;
export type FeeProblem = (typeof FEE_PROBLEMS)[number];

export type FeeRow = {
  slug: string;
  fee: number | null;
  frequency: string | null;
  /** The data_sources slug. */
  source: string;
  /** The search's (SQL) monthly equivalent of the row. */
  sqlMonthly: number | null;
};

export function classifyFeeRow(r: FeeRow): FeeProblem[] {
  const problems: FeeProblem[] = [];
  if (r.frequency !== null && !isHoaFrequency(r.frequency)) problems.push(UNKNOWN_KEY);
  // The gamls2 feed sends no AssociationFeeFrequency, and Georgia MLS defines
  // AssociationFee as the "Annual Association Fee", so the mapper resolves every Georgia
  // MLS fee to annually: any other stored period (null before the resync, or 'monthly',
  // the original bug) is wrong. Revisit this rule if Georgia MLS ever starts sending
  // AssociationFeeFrequency.
  if (r.source === GAMLS_SLUG && (r.fee ?? 0) > 0 && r.frequency !== "annually")
    problems.push(GAMLS_NOT_ANNUAL);
  const js = monthlyHoaEquivalent(r.fee, r.frequency);
  if ((js === null) !== (r.sqlMonthly === null) || Math.abs((js ?? 0) - (r.sqlMonthly ?? 0)) > 0.01)
    problems.push(SQL_JS_DRIFT);
  return problems;
}
