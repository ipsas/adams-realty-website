import { describe, expect, it } from "vitest";
import {
  daysSince,
  formatBaths,
  formatChangeChip,
  formatLot,
  formatMonthly,
  formatMonthlyShort,
  formatPriceShort,
  formatRelativeShort,
  formatStreet,
  freshness,
  STALE_FEED_MS,
  staffStatusLabel,
  statusLabel,
} from "./format";
import { estimateMonthlyCost, monthlyHoaAmount, monthlyPrincipalAndInterest } from "./mortgage";

describe("format", () => {
  it("formats compact prices for map pins", () => {
    expect(formatPriceShort(725_000)).toBe("$725K");
    expect(formatPriceShort(1_250_000)).toBe("$1.25M");
    expect(formatPriceShort(1_000_000)).toBe("$1M");
    expect(formatPriceShort(12_500_000)).toBe("$12.5M");
    expect(formatPriceShort(2_450)).toBe("$2K");
  });

  it("formats baths and lots", () => {
    expect(formatBaths(2.5)).toBe("2.5");
    expect(formatBaths(3)).toBe("3");
    expect(formatLot(7_841)).toBe("7,841 sqft lot");
    expect(formatLot(43_560)).toBe("1 acres");
    expect(formatLot(65_340)).toBe("1.5 acres");
  });

  it("respects suppressed addresses", () => {
    const a = { addressLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" };
    expect(formatStreet({ ...a, unitNumber: "4B" })).toBe("1 Main St #4B");
    expect(formatStreet({ ...a, hideAddress: true })).toBe("Address withheld by seller");
  });

  it("never doubles the unit '#'", () => {
    const a = { addressLine1: "1 Main St", city: "Austin", state: "TX", postalCode: "78701" };
    expect(formatStreet({ ...a, unitNumber: "#317" })).toBe("1 Main St #317");
    expect(formatStreet({ ...a, unitNumber: "# 317" })).toBe("1 Main St #317");
    expect(formatStreet({ ...a, unitNumber: "##12" })).toBe("1 Main St #12");
    expect(formatStreet({ ...a, unitNumber: "4B" })).toBe("1 Main St #4B");
    expect(formatStreet({ ...a, unitNumber: "#" })).toBe("1 Main St");
  });

  it("counts days on market", () => {
    expect(daysSince("2026-09-20", new Date("2026-09-25T15:00:00Z"))).toBe(5);
    expect(daysSince("2026-09-30", new Date("2026-09-25T15:00:00Z"))).toBeLessThan(0);
  });

  it("tells staff which off-market status a listing is in; the public sees one label", () => {
    for (const s of ["withdrawn", "expired", "canceled"]) expect(statusLabel(s)).toBe("Off market");
    expect(staffStatusLabel("withdrawn")).toBe("Withdrawn");
    expect(staffStatusLabel("expired")).toBe("Expired");
    expect(staffStatusLabel("canceled")).toBe("Canceled");
    expect(staffStatusLabel("coming_soon")).toBe("Coming soon");
    expect(staffStatusLabel("active", "rent")).toBe("For rent");
    expect(staffStatusLabel("closed")).toBe("Sold");
  });
});

describe("monthly and relative formats", () => {
  const now = new Date("2026-09-25T16:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms);
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it("formats monthly amounts", () => {
    expect(formatMonthly(3411.6)).toBe("$3,412/mo");
    expect(formatMonthly(950)).toBe("$950/mo");
    expect(formatMonthlyShort(3412)).toBe("$3.4K/mo");
    expect(formatMonthlyShort(3000)).toBe("$3K/mo");
    expect(formatMonthlyShort(949.6)).toBe("$950/mo");
    expect(formatMonthlyShort(12_480)).toBe("$12.5K/mo");
    expect(formatMonthlyShort(125_400)).toBe("$125K/mo");
  });

  it("formats terse relative times", () => {
    expect(formatRelativeShort(ago(20_000), now)).toBe("now");
    expect(formatRelativeShort(ago(6 * MIN), now)).toBe("6m");
    expect(formatRelativeShort(ago(3 * HOUR + 5 * MIN), now)).toBe("3h");
    expect(formatRelativeShort(ago(3 * DAY), now)).toBe("3d");
    expect(formatRelativeShort("2026-09-02T16:00:00Z", now)).toBe("Sep 2");
    expect(formatRelativeShort("2025-10-02T16:00:00Z", now)).toBe("Oct 2, 2025");
    // Clock skew: a future time reads as "now", not a negative age.
    expect(formatRelativeShort(ago(-5 * MIN), now)).toBe("now");
  });

  it("labels saved-home changes", () => {
    const at = ago(3 * DAY);
    expect(
      formatChangeChip(
        { type: "price_change", price: 475_000, previousPrice: 500_000, occurredAt: at },
        now,
      ),
    ).toBe("Price cut $25K · 3d");
    expect(
      formatChangeChip(
        { type: "price_change", price: 510_000, previousPrice: 500_000, occurredAt: ago(DAY) },
        now,
      ),
    ).toBe("Price up $10K · 1d");
    expect(
      formatChangeChip(
        { type: "price_change", price: 2_350, previousPrice: 2_500, occurredAt: at },
        now,
      ),
    ).toBe("Price cut $150 · 3d");
    expect(
      formatChangeChip(
        { type: "price_change", price: 487_500, previousPrice: 500_000, occurredAt: at },
        now,
      ),
    ).toBe("Price cut $12.5K · 3d");
    expect(formatChangeChip({ type: "status_change", toStatus: "pending", occurredAt: at })).toBe(
      "Now pending",
    );
    expect(
      formatChangeChip({
        type: "status_change",
        toStatus: "active_under_contract",
        occurredAt: at,
      }),
    ).toBe("Now pending");
    expect(formatChangeChip({ type: "sold", occurredAt: at })).toBe("Sold");
    expect(formatChangeChip({ type: "relisted", occurredAt: at })).toBe("Back on market");
    expect(formatChangeChip({ type: "status_change", toStatus: "active", occurredAt: at })).toBe(
      "Back on market",
    );
    expect(
      formatChangeChip({ type: "price_change", price: 1, previousPrice: 1, occurredAt: at }),
    ).toBeNull();
  });

  it("reports feed freshness and never claims a stale feed is current", () => {
    expect(freshness(ago(12 * MIN), now)).toEqual({
      stale: false,
      label: "Updated 12 min ago",
      notice: null,
    });
    expect(freshness(ago(10_000), now).label).toBe("Updated just now");
    expect(freshness(ago(75 * MIN), now).label).toBe("Updated 1 hr ago");
    expect(freshness(ago(STALE_FEED_MS), now).stale).toBe(false);

    const stale = freshness(ago(STALE_FEED_MS + MIN), now);
    expect(stale.stale).toBe(true);
    expect(stale.label).toBeNull();
    expect(stale.notice).toBe("Listing data last updated Sep 25, 9:59 AM — it may be out of date");
    expect(stale.notice).not.toMatch(/Updated .* ago/);

    expect(freshness(null, now)).toEqual({
      stale: true,
      label: null,
      notice: "Listing data may be out of date",
    });
    expect(freshness(new Date("2025-01-05T15:00:00Z"), now).notice).toContain("Jan 5, 2025");
  });
});

describe("mortgage", () => {
  it("matches the standard amortization formula", () => {
    // $400k at 6% for 30 years ≈ $2,398.20/mo
    expect(monthlyPrincipalAndInterest(400_000, 6, 30)).toBeCloseTo(2398.2, 1);
    expect(monthlyPrincipalAndInterest(360_000, 0, 30)).toBe(1000);
  });

  it("includes taxes, insurance, HOA, and PMI below 20% down", () => {
    const cost = estimateMonthlyCost({
      price: 500_000,
      downPaymentPct: 10,
      interestRatePct: 6,
      loanTermYears: 30,
      annualTax: 9_600,
      annualInsurance: 2_400,
      monthlyHoa: 50,
    });
    expect(cost.loanAmount).toBe(450_000);
    expect(cost.taxes).toBe(800);
    expect(cost.insurance).toBe(200);
    expect(cost.pmi).toBeCloseTo(187.5);
    expect(cost.total).toBeCloseTo(cost.principalAndInterest + 800 + 200 + 50 + 187.5);
  });

  it("normalizes HOA frequency to monthly", () => {
    expect(monthlyHoaAmount(300, "quarterly")).toBe(100);
    expect(monthlyHoaAmount(1200, "annually")).toBe(100);
    expect(monthlyHoaAmount(null, "monthly")).toBe(0);
  });
});
