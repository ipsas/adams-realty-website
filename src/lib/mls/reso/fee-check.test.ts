import { describe, expect, it } from "vitest";
import type { MapResult } from "../types";
import { feeCheckWarning, feeDisplayMismatches } from "./fee-check";
import hoa from "./fixtures/hoa-fee-frequency.json";
import { mapResoProperty, type ResoProperty } from "./mapper";

const raw = hoa.value as ResoProperty[];
const byKey = (key: string) => raw.find((p) => p.ListingKey === key)!;

/** The mapped listing with its fee overwritten, as a buggy mapper would produce it. */
function withHoa(p: ResoProperty, hoaFee: number | null, hoaFrequency: "monthly" | null) {
  const m = mapResoProperty(p);
  if (!m.ok) throw new Error("expected ok");
  return { ok: true, listing: { ...m.listing, hoaFee, hoaFrequency } } satisfies MapResult;
}

describe("feeDisplayMismatches", () => {
  it("passes the mapper's own output and reports unrecognized raw frequencies", () => {
    const c = feeDisplayMismatches(raw, raw.map(mapResoProperty));
    expect(c).toEqual({
      checked: raw.length,
      mismatched: 0,
      unrecognizedFrequency: { "Every Blue Moon": 1 },
    });
    expect(feeCheckWarning(c)).toBe(
      `HOA fee check: 0 of ${raw.length} fees mismatched the raw MLS data; unrecognized AssociationFeeFrequency: "Every Blue Moon"×1`,
    );
  });

  it("flags a Georgia MLS fee stored as monthly (the old default)", () => {
    const adaline = raw.find((p) => p.ListingId === "10838419")!;
    const c = feeDisplayMismatches([adaline], [withHoa(adaline, 500, "monthly")]);
    expect(c).toMatchObject({ checked: 1, mismatched: 1 });
    expect(feeCheckWarning(c)).toContain("1 of 1 fees mismatched");
  });

  it("flags a guessed period, a wrong amount and a fee the MLS didn't send", () => {
    const unknown = byKey("TEST-HOA-08");
    const monthly = byKey("TEST-HOA-01");
    const none: ResoProperty = { ...monthly, AssociationFee: undefined };
    const c = feeDisplayMismatches(
      [unknown, monthly, none],
      [
        withHoa(unknown, 275, "monthly"),
        withHoa(monthly, 25, "monthly"),
        withHoa(none, 250, "monthly"),
      ],
    );
    expect(c).toEqual({ checked: 3, mismatched: 3, unrecognizedFrequency: {} });
  });

  it("skips records without a fee and records the mapper skipped", () => {
    const noFee: ResoProperty = { ...byKey("TEST-HOA-01"), AssociationFee: undefined };
    const c = feeDisplayMismatches(
      [noFee, byKey("TEST-HOA-02")],
      [mapResoProperty(noFee), { ok: false, listingKey: "x", reason: "missing_price" }],
    );
    expect(c).toEqual({ checked: 0, mismatched: 0, unrecognizedFrequency: {} });
    expect(feeCheckWarning(c)).toBeNull();
  });

  it("leaves out an AssociationYN-false fee, as the mapper does", () => {
    const p: ResoProperty = { ...byKey("TEST-HOA-01"), AssociationYN: "N" };
    expect(feeDisplayMismatches([p], [mapResoProperty(p)])).toMatchObject({ mismatched: 0 });
  });
});
