import { describe, expect, it, vi } from "vitest";
import { listingMedia, listings } from "@/db/schema";
import { InvalidRowError, sanitizeNumeric } from "./sanitize";

const LABEL = "listing 3yd-GAMLS-10854420 (MLS 10854420)";

function run<T extends object>(row: T, table: Parameters<typeof sanitizeNumeric>[0] = listings) {
  const warn = vi.fn<(message: string) => void>();
  return { out: sanitizeNumeric(table, row, LABEL, warn), warn };
}

describe("sanitizeNumeric", () => {
  it("nulls a lot size past integer's range, with a warning naming the listing, field and value", () => {
    // MLS 10854420, 3771 Tramore Pointe Pkwy, Austell: the value that stopped the full sync.
    const { out, warn } = run({ listPrice: 4_500, lotSizeSqft: 2_182_094_640 });
    expect(out).toEqual({ listPrice: 4_500, lotSizeSqft: null });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("10854420");
    expect(warn.mock.calls[0][0]).toContain("lotSizeSqft");
    expect(warn.mock.calls[0][0]).toContain("2182094640");
    expect(warn.mock.calls[0][0]).toContain("out of range for integer");
  });

  it("leaves ordinary values alone, and returns the same row", () => {
    const row = {
      listingKey: "K1",
      lotSizeSqft: 7_841,
      listPrice: 450_000,
      bathrooms: 2.5,
      yearBuilt: 1998,
      bedrooms: 0,
      latitude: 34.37,
      longitude: -83.11,
      city: "Royston",
      closePrice: null,
      hoaFee: undefined,
    };
    const { out, warn } = run(row);
    expect(out).toBe(row);
    expect(warn).not.toHaveBeenCalled();
  });

  it("nulls NaN, Infinity and negative values", () => {
    const { out, warn } = run({
      livingAreaSqft: Number.NaN,
      bathrooms: Number.POSITIVE_INFINITY,
      taxAnnualAmount: -1,
      hoaFee: -250,
      garageSpaces: -2,
    });
    expect(out).toEqual({
      livingAreaSqft: null,
      bathrooms: null,
      taxAnnualAmount: null,
      hoaFee: null,
      garageSpaces: null,
    });
    expect(warn).toHaveBeenCalledTimes(5);
  });

  it("nulls smallint overflow, and a fraction in an integer column", () => {
    const { out } = run({ yearBuilt: 19_980_101, bedrooms: 40_000, livingAreaSqft: 1_500.5 });
    expect(out).toEqual({ yearBuilt: null, bedrooms: null, livingAreaSqft: null });
  });

  it("nulls a value past real's range", () => {
    const { out } = run({ bathrooms: 1e39 });
    expect(out).toEqual({ bathrooms: null });
  });

  it("allows negative coordinates, not infinite ones", () => {
    const { out } = run({ latitude: -33.9, longitude: Number.NEGATIVE_INFINITY });
    expect(out).toEqual({ latitude: -33.9, longitude: null });
  });

  it("keeps coordinates up to ±90 / ±180, nulls those past them", () => {
    for (const [latitude, longitude] of [
      [90, 180],
      [-90, -180],
    ]) {
      const { out, warn } = run({ latitude, longitude });
      expect(out).toEqual({ latitude, longitude });
      expect(warn).not.toHaveBeenCalled();
    }
    const { out, warn } = run({ latitude: 90.0001, longitude: -180.5 });
    expect(out).toEqual({ latitude: null, longitude: null });
    expect(warn.mock.calls[0][0]).toContain("latitude = 90.0001 is out of range for -90..90");
    expect(warn.mock.calls[1][0]).toContain("out of range for -180..180");
    expect(run({ latitude: -91, longitude: 181 }).out).toEqual({ latitude: null, longitude: null });
    // A double far past both: the bound applies, not the type's range.
    expect(run({ latitude: 1e39 }).out).toEqual({ latitude: null });
  });

  it("refuses a NOT NULL column it can't null, so the row fails instead", () => {
    expect(() => run({ listPrice: 3_000_000_000, lotSizeSqft: 7_841 })).toThrow(InvalidRowError);
    expect(() => run({ photoCount: 40_000 })).toThrow(/photoCount = 40000 is out of range/);
  });

  it("follows each table's own columns (listing media)", () => {
    const { out } = run(
      { url: "https://x/1.jpg", width: -640, height: 480, sortOrder: 3 },
      listingMedia,
    );
    expect(out).toEqual({ url: "https://x/1.jpg", width: null, height: 480, sortOrder: 3 });
  });
});
