/**
 * The permanent HOA fee guard: every fixture record, raw MLS data in, must come out of
 * the mapper showing the fee and period the MLS gave, and count in the monthly
 * estimate only by that period. The expectation is derived here from the raw record,
 * by this file's own table, never by the production parse/format helpers.
 */
import { describe, expect, it } from "vitest";
import page1 from "@/lib/mls/reso/fixtures/bridge-gamls-page1.json";
import page2 from "@/lib/mls/reso/fixtures/bridge-gamls-page2.json";
import hoa from "@/lib/mls/reso/fixtures/hoa-fee-frequency.json";
import { mapResoProperty, type ResoProperty } from "@/lib/mls/reso/mapper";
import { monthlyHoaAmount } from "@/lib/mortgage";
import { hoaFact, listingDetailGroups, type DetailListing } from "./detail-fields";

/** Raw RESO FeeFrequency (lowercase letters only) → [long text, short text, months per period]. */
const PERIODS: Record<string, [string, string, number | null]> = {
  monthly: ["/month", "/mo", 1],
  quarterly: ["/quarter", "/qtr", 3],
  semiannually: ["/6 months", "/6 mo", 6],
  annually: ["/year", "/yr", 12],
  bimonthly: ["/2 months", "/2 mo", 2],
  semimonthly: [" semi-monthly", " semi-monthly", 0.5],
  weekly: ["/week", "/wk", 12 / 52],
  biweekly: ["/2 weeks", "/2 wks", 12 / 26],
  daily: ["/day", "/day", 12 / 365],
  onetime: [" one-time", " one-time", null],
  seasonal: [" seasonal", " seasonal", null],
};

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

function expected(p: ResoProperty) {
  const fee =
    typeof p.AssociationFee === "number" && p.AssociationFee > 0 ? p.AssociationFee : null;
  if (fee === null) return null;
  const raw = typeof p.AssociationFeeFrequency === "string" ? p.AssociationFeeFrequency : "";
  const key = raw.toLowerCase().replace(/[^a-z]/g, "");
  // Georgia MLS (GAMLS2_ fields) sends no frequency: its AssociationFee is "Annual Association Fee".
  const gamls = Object.keys(p).some((k) => k.startsWith("GAMLS2_"));
  const period = key ? PERIODS[key] : gamls ? PERIODS.annually : undefined;
  const [long, short, months] = period ?? ["", "", null];
  return {
    long: usd(fee) + long,
    short: usd(fee) + short,
    monthly: months === null ? 0 : fee / months,
    isMonthly: key === "monthly",
  };
}

const empty: Omit<DetailListing, "associationYN" | "hoaFee" | "hoaFrequency"> = {
  features: {},
  fireplacesTotal: null,
  parkingTotal: null,
  mainLevelBedrooms: null,
  primaryBedroomOnMain: null,
  garageSpaces: null,
  lotSizeSqft: null,
  lotSizeDimensions: null,
  neighborhood: null,
  seniorCommunity: null,
  taxAnnualAmount: null,
  taxYear: null,
  taxAssessedValue: null,
  zoning: null,
};

function shown(p: ResoProperty) {
  const r = mapResoProperty(p);
  if (!r.ok) throw new Error(`${p.ListingKey} didn't map: ${r.reason}`);
  const l: DetailListing = {
    ...empty,
    associationYN: r.listing.associationYN ?? null,
    hoaFee: r.listing.hoaFee ?? null,
    hoaFrequency: r.listing.hoaFrequency ?? null,
  };
  const row = listingDetailGroups(l)
    .flatMap((g) => g.rows)
    .find((x) => x.label === "HOA fee");
  return {
    fact: hoaFact(l),
    row: row?.value ?? null,
    monthly: monthlyHoaAmount(l.hoaFee, l.hoaFrequency),
  };
}

const records = [page1, page2, hoa].flatMap((f) => f.value as ResoProperty[]);
const mappable = records.filter((p) => mapResoProperty(p).ok);

describe("HOA fees shown exactly as the MLS gives them", () => {
  it("has fee records to check", () => {
    expect(mappable.filter((p) => expected(p)).length).toBeGreaterThanOrEqual(9);
  });

  it.each(mappable.map((p) => [p.ListingKey, p] as const))("%s", (_key, p) => {
    const want = expected(p);
    const got = shown(p);
    if (!want) {
      expect(got.row).toBeNull();
      expect(got.monthly).toBe(0);
      expect(got.fact ?? "").not.toMatch(/\$/);
      return;
    }
    expect(got.fact).toBe(want.short);
    expect(got.row).toBe(want.long);
    expect(got.monthly).toBeCloseTo(want.monthly, 10);
    if (!want.isMonthly) {
      expect(got.fact).not.toMatch(/\/mo\b/);
      expect(got.row).not.toMatch(/\/month\b/);
    }
  });

  it("shows 71 Adaline Ct (MLS# 10838419) at $500 a year, as Georgia MLS does", () => {
    const p = records.find((r) => r.ListingId === "10838419")!;
    expect(shown(p)).toEqual({ fact: "$500/yr", row: "$500/year", monthly: 500 / 12 });
  });

  it("shows a fee of unknown period with no period, and leaves it out of the monthly cost", () => {
    for (const key of ["TEST-HOA-07", "TEST-HOA-08"]) {
      const p = records.find((r) => r.ListingKey === key)!;
      const got = shown(p);
      expect(got.fact).toBe(usd(p.AssociationFee as number));
      expect(got.row).toBe(usd(p.AssociationFee as number));
      expect(got.fact).not.toContain("/");
      expect(got.monthly).toBe(0);
    }
  });
});
