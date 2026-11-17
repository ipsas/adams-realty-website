import { describe, expect, it } from "vitest";
import { GAMLS_SLUG } from "@/lib/mls/gamls";
import {
  classifyFeeRow,
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
