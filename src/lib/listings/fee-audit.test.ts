import { describe, expect, it } from "vitest";
import { GAMLS_SLUG } from "@/lib/mls/gamls";
import {
  AUDIT_EXAMPLES,
  auditFeeAggregate,
  classifyFeeRow,
  describeFeeAudit,
  type FeeGroup,
  GAMLS_NOT_ANNUAL,
  SQL_JS_DRIFT,
  UNKNOWN_KEY,
  type FeeRow,
} from "./fee-audit";
import { monthlyHoaEquivalent } from "./hoa-fee";

/** A row whose SQL monthly equivalent agrees with the JS one, unless overridden. */
function row(over: Partial<FeeRow>): FeeRow {
  const r: FeeRow = { slug: "x", fee: 600, frequency: null, source: "other", sqlMonthly: null };
  Object.assign(r, over);
  if (!("sqlMonthly" in over)) r.sqlMonthly = monthlyHoaEquivalent(r.fee, r.frequency);
  return r;
}

describe("classifyFeeRow", () => {
  it("flags a Georgia MLS fee stored as monthly", () => {
    expect(classifyFeeRow(row({ source: GAMLS_SLUG, frequency: "monthly" }))).toEqual([
      GAMLS_NOT_ANNUAL,
    ]);
  });

  it("flags a Georgia MLS fee with no stored frequency", () => {
    expect(classifyFeeRow(row({ source: GAMLS_SLUG, frequency: null }))).toEqual([
      GAMLS_NOT_ANNUAL,
    ]);
  });

  it("accepts a Georgia MLS fee stored as annually", () => {
    expect(classifyFeeRow(row({ source: GAMLS_SLUG, frequency: "annually" }))).toEqual([]);
  });

  it("accepts another feed's monthly or unknown-period fee", () => {
    expect(classifyFeeRow(row({ frequency: "monthly" }))).toEqual([]);
    expect(classifyFeeRow(row({ frequency: null }))).toEqual([]);
  });

  it("flags a frequency that isn't a RESO FeeFrequency key", () => {
    expect(classifyFeeRow(row({ frequency: "fortnightly" }))).toEqual([UNKNOWN_KEY]);
  });

  it("flags SQL vs JS monthly drift", () => {
    expect(classifyFeeRow(row({ frequency: "annually", sqlMonthly: 600 }))).toEqual([SQL_JS_DRIFT]);
    expect(classifyFeeRow(row({ frequency: null, sqlMonthly: 600 }))).toEqual([SQL_JS_DRIFT]);
  });
});

describe("auditFeeAggregate", () => {
  /** A group whose SQL monthly equivalent agrees with the JS one, unless overridden. */
  const group = (frequency: string | null, count: number, over: Partial<FeeGroup> = {}) => ({
    frequency,
    count,
    sampleFee: 600,
    sampleSqlMonthly: monthlyHoaEquivalent(600, frequency),
    examples: [] as string[],
    ...over,
  });

  it("passes Georgia MLS fees all stored as annually", () => {
    const audit = auditFeeAggregate([group("annually", 500)], { gamls: true });
    expect(audit).toEqual({ total: 500, problems: {}, examples: [] });
    expect(describeFeeAudit(audit)).toBeNull();
  });

  it("counts Georgia MLS rows stored as monthly or null, with examples", () => {
    const audit = auditFeeAggregate(
      [
        group("annually", 500),
        group("monthly", 3, { examples: ["1", "2", "3"] }),
        group(null, 4, { examples: ["4", "5", "6", "7"] }),
      ],
      { gamls: true },
    );
    expect(audit.total).toBe(507);
    expect(audit.problems).toEqual({ [GAMLS_NOT_ANNUAL]: 7 });
    expect(audit.examples).toEqual(["1", "2", "3", "4", "5"]);
    expect(audit.examples).toHaveLength(AUDIT_EXAMPLES);
    expect(describeFeeAudit(audit)).toBe(`${GAMLS_NOT_ANNUAL}: 7`);
  });

  it("accepts another feed's monthly or null periods", () => {
    const audit = auditFeeAggregate([group("monthly", 3), group(null, 2)], { gamls: false });
    expect(audit.problems).toEqual({});
  });

  it("flags a bogus key", () => {
    const audit = auditFeeAggregate([group("fortnightly", 2, { examples: ["9"] })], {
      gamls: false,
    });
    expect(audit.problems).toEqual({ [UNKNOWN_KEY]: 2 });
    expect(audit.examples).toEqual(["9"]);
    expect(auditFeeAggregate([group("fortnightly", 2)], { gamls: true }).problems).toEqual({
      [UNKNOWN_KEY]: 2,
      [GAMLS_NOT_ANNUAL]: 2,
    });
  });

  it("flags a group whose SQL monthly equivalent drifted from JS", () => {
    const audit = auditFeeAggregate([group("annually", 8, { sampleSqlMonthly: 600 })], {
      gamls: true,
    });
    expect(audit.problems).toEqual({ [SQL_JS_DRIFT]: 8 });
    expect(describeFeeAudit(audit)).toBe(`${SQL_JS_DRIFT}: 8`);
  });

  it("reports labels in FEE_PROBLEMS order", () => {
    const audit = auditFeeAggregate(
      [group("annually", 1, { sampleSqlMonthly: 1 }), group("weird", 2)],
      { gamls: true },
    );
    expect(describeFeeAudit(audit)).toBe(
      `${UNKNOWN_KEY}: 2; ${GAMLS_NOT_ANNUAL}: 2; ${SQL_JS_DRIFT}: 1`,
    );
  });
});
