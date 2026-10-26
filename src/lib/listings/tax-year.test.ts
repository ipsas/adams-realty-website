import { describe, expect, it } from "vitest";
import { normalizeTaxYear } from "./tax-year";

const NOW = new Date("2026-10-26");

describe("normalizeTaxYear", () => {
  it("reads 2-digit years as 2000+", () => {
    expect(normalizeTaxYear(24, NOW)).toBe(2024);
    expect(normalizeTaxYear(25, NOW)).toBe(2025);
    expect(normalizeTaxYear("24", NOW)).toBe(2024);
  });

  it("keeps plausible 4-digit years", () => {
    expect(normalizeTaxYear(2024, NOW)).toBe(2024);
    expect(normalizeTaxYear(2027, NOW)).toBe(2027);
  });

  it("drops years outside 1900…next year", () => {
    expect(normalizeTaxYear(99, NOW)).toBeNull();
    expect(normalizeTaxYear(1899, NOW)).toBeNull();
    expect(normalizeTaxYear(2028, NOW)).toBeNull();
    expect(normalizeTaxYear(-1, NOW)).toBeNull();
  });

  it("drops missing and non-integer values", () => {
    for (const v of [null, undefined, "", "abc", 24.5]) {
      expect(normalizeTaxYear(v, NOW)).toBeNull();
    }
  });
});
