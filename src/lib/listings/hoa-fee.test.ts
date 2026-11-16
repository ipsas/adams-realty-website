import { describe, expect, it } from "vitest";
import {
  formatHoaFee,
  HOA_FREQUENCIES,
  monthlyHoaEquivalent,
  parseFeeFrequency,
  type HoaFrequency,
} from "./hoa-fee";

describe("parseFeeFrequency", () => {
  it.each<[string, HoaFrequency]>([
    ["Monthly", "monthly"],
    ["Quarterly", "quarterly"],
    ["Semi-Annually", "semi_annually"],
    ["Annually", "annually"],
    ["Bi-Monthly", "bi_monthly"],
    ["Semi-Monthly", "semi_monthly"],
    ["Bi-Weekly", "bi_weekly"],
    ["Weekly", "weekly"],
    ["Daily", "daily"],
    ["One Time", "one_time"],
    ["Seasonal", "seasonal"],
    // Aliases and spellings.
    ["Annual", "annually"],
    ["Yearly", "annually"],
    ["Semi-Annual", "semi_annually"],
    ["Every Six Months", "semi_annually"],
    ["One-Time", "one_time"],
    ["MONTHLY", "monthly"],
    [" semi annually ", "semi_annually"],
    ["semi_annually", "semi_annually"],
    ["bi weekly", "bi_weekly"],
    ["BiMonthly", "bi_monthly"],
  ])("%j -> %s", (raw, expected) => {
    expect(parseFeeFrequency(raw)).toBe(expected);
  });

  it("parses every stored key back to itself", () => {
    for (const f of HOA_FREQUENCIES) expect(parseFeeFrequency(f)).toBe(f);
  });

  it("never reads a prefix as a shorter period", () => {
    expect(parseFeeFrequency("Bi-Monthly")).not.toBe("monthly");
    expect(parseFeeFrequency("Semi-Monthly")).not.toBe("monthly");
    expect(parseFeeFrequency("Semi-Annually")).not.toBe("annually");
    expect(parseFeeFrequency("Bi-Weekly")).not.toBe("weekly");
  });

  it.each([
    "",
    " ",
    "Every Blue Moon",
    "Month",
    "Monthly Fee",
    "Annually and Monthly",
    "Other",
    "toString",
    "constructor",
  ])("%j -> null", (raw) => {
    expect(parseFeeFrequency(raw)).toBeNull();
  });

  it("is null for non-strings", () => {
    for (const v of [null, undefined, 12, true, {}, ["Monthly"]])
      expect(parseFeeFrequency(v)).toBeNull();
  });
});

describe("formatHoaFee", () => {
  it.each<[HoaFrequency | null, string, string]>([
    ["monthly", "$1,200/month", "$1,200/mo"],
    ["quarterly", "$1,200/quarter", "$1,200/qtr"],
    ["annually", "$1,200/year", "$1,200/yr"],
    ["semi_annually", "$1,200/6 months", "$1,200/6 mo"],
    ["bi_monthly", "$1,200/2 months", "$1,200/2 mo"],
    ["weekly", "$1,200/week", "$1,200/wk"],
    ["bi_weekly", "$1,200/2 weeks", "$1,200/2 wks"],
    ["daily", "$1,200/day", "$1,200/day"],
    ["semi_monthly", "$1,200 semi-monthly", "$1,200 semi-monthly"],
    ["one_time", "$1,200 one-time", "$1,200 one-time"],
    ["seasonal", "$1,200 seasonal", "$1,200 seasonal"],
    [null, "$1,200", "$1,200"],
  ])("%s", (frequency, long, short) => {
    expect(formatHoaFee(1200, frequency, "long")).toBe(long);
    expect(formatHoaFee(1200, frequency, "short")).toBe(short);
  });

  it("labels every frequency", () => {
    for (const f of HOA_FREQUENCIES) {
      expect(formatHoaFee(1, f, "long")).not.toBe("$1");
      expect(formatHoaFee(1, f, "short")).not.toBe("$1");
    }
  });
});

describe("monthlyHoaEquivalent", () => {
  it.each<[HoaFrequency, number | null]>([
    ["monthly", 1200],
    ["quarterly", 400],
    ["semi_annually", 200],
    ["annually", 100],
    ["bi_monthly", 600],
    ["semi_monthly", 2400],
    ["weekly", (1200 * 52) / 12],
    ["bi_weekly", (1200 * 26) / 12],
    ["daily", (1200 * 365) / 12],
    ["one_time", null],
    ["seasonal", null],
  ])("%s", (frequency, expected) => {
    expect(monthlyHoaEquivalent(1200, frequency)).toBe(expected);
  });

  it("is null without a fee or a known period", () => {
    expect(monthlyHoaEquivalent(1200, null)).toBeNull();
    expect(monthlyHoaEquivalent(1200, undefined)).toBeNull();
    expect(monthlyHoaEquivalent(1200, "fortnightly")).toBeNull();
    expect(monthlyHoaEquivalent(null, "monthly")).toBeNull();
    expect(monthlyHoaEquivalent(0, "monthly")).toBeNull();
  });
});
