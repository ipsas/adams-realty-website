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

/**
 * One stored hoa_frequency of a source's fee rows (hoa_fee > 0), as the sync's audit
 * query (SyncStore.auditFees) groups them.
 */
export type FeeGroup = {
  frequency: string | null;
  count: number;
  /** One fee of the group (the query's min), to compare its SQL and JS monthly equivalents. */
  sampleFee: number;
  /** The search's (SQL) monthly equivalent of `sampleFee` at this frequency. */
  sampleSqlMonthly: number | null;
  /** Up to a few MLS numbers (or listing ids) of the group's rows not stored as annually. */
  examples: string[];
};

/** What the sync's audit found: problem counts by label (classifyFeeRow's), only nonzero. */
export type FeeAudit = {
  /** Rows with a fee. */
  total: number;
  problems: Partial<Record<FeeProblem, number>>;
  /** Up to AUDIT_EXAMPLES MLS numbers (or listing ids) of rows with a problem. */
  examples: string[];
};

export const AUDIT_EXAMPLES = 5;

export const emptyFeeAudit = (): FeeAudit => ({ total: 0, problems: {}, examples: [] });

/**
 * classifyFeeRow over a source's grouped fee rows: every row of a group shares its
 * frequency (and has a fee above $0), so the group's labels are each of its rows';
 * the SQL-vs-JS drift is judged on the group's sample fee. `gamls`: the source is the
 * Georgia MLS one.
 */
export function auditFeeAggregate(groups: FeeGroup[], { gamls }: { gamls: boolean }): FeeAudit {
  const audit = emptyFeeAudit();
  for (const g of groups) {
    audit.total += g.count;
    const labels = classifyFeeRow({
      slug: "",
      fee: g.sampleFee,
      frequency: g.frequency,
      source: gamls ? GAMLS_SLUG : "",
      sqlMonthly: g.sampleSqlMonthly,
    });
    for (const label of labels) audit.problems[label] = (audit.problems[label] ?? 0) + g.count;
    if (labels.length) audit.examples.push(...g.examples);
  }
  audit.examples = audit.examples.slice(0, AUDIT_EXAMPLES);
  return audit;
}

/** "<label>: <n>; …", in FEE_PROBLEMS order, or null when the audit found nothing. */
export function describeFeeAudit(audit: FeeAudit): string | null {
  const parts = FEE_PROBLEMS.flatMap((label) =>
    audit.problems[label] ? [`${label}: ${audit.problems[label]}`] : [],
  );
  return parts.length ? parts.join("; ") : null;
}
