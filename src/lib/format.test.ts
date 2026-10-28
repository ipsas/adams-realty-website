import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cutAtWord,
  daysOnMarket,
  daysOnMarketLabel,
  daysSince,
  formatBaths,
  formatChangeChip,
  formatCityLine,
  formatDisplayPhone,
  formatLot,
  formatMonthly,
  formatMonthlyShort,
  formatPriceShort,
  formatRelativeShort,
  formatStreet,
  formatUnit,
  freshness,
  isNewListing,
  isNullLike,
  listingMetaDescription,
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

  it("formats units the way Georgia MLS sends them consistently", () => {
    expect(formatUnit("A & B")).toBe("#A & B");
    expect(formatUnit("A AND B")).toBe("#A & B");
    expect(formatUnit("a and b")).toBe("#a & b");
    expect(formatUnit("ANDOVER")).toBe("#ANDOVER");
    expect(formatUnit("A")).toBe("#A");
    expect(formatUnit("LOT 8")).toBe("Lot 8");
    expect(formatUnit("#Unit 4")).toBe("Unit 4");
    expect(formatUnit("APT 2B")).toBe("Apt 2B");
    expect(formatUnit("ste. 100")).toBe("Ste 100");
    expect(formatUnit("SUITE 210")).toBe("Suite 210");
    expect(formatUnit("BLDG C")).toBe("Bldg C");
    expect(formatUnit("LOTUS")).toBe("#LOTUS");
    expect(formatUnit("  ")).toBeNull();
    expect(formatUnit(null)).toBeNull();
    expect(
      formatStreet({ addressLine1: "424 Harbor Point", unitNumber: "LOT 8", hideAddress: false }),
    ).toBe("424 Harbor Point Lot 8");
  });

  it("recognizes placeholder values", () => {
    for (const v of ["None", "none", " NONE ", "n/a", "NA", "-", "0", "", "  ", null, undefined]) {
      expect(isNullLike(v), String(v)).toBe(true);
    }
    for (const v of ["Harbor Pointe", "Nonesuch", "10"]) expect(isNullLike(v), v).toBe(false);
  });

  it("counts days on market", () => {
    expect(daysSince("2026-09-20", new Date("2026-09-25T15:00:00Z"))).toBe(5);
    expect(daysSince("2026-09-30", new Date("2026-09-25T15:00:00Z"))).toBeLessThan(0);
  });

  describe("daysOnMarket", () => {
    it("counts whole calendar days from the market date", () => {
      expect(daysOnMarket("2026-12-20", "2026-12-20")).toBe(0);
      expect(daysOnMarket("2026-12-19", "2026-12-20")).toBe(1);
      expect(daysOnMarket("2026-10-25", "2026-10-28")).toBe(3);
      // Across the DST change (2026-11-01 in New York) and a year end.
      expect(daysOnMarket("2026-10-31", "2026-11-02")).toBe(2);
      expect(daysOnMarket("2026-12-30", "2027-01-02")).toBe(3);
    });

    it("is null when unknown or not on market yet", () => {
      expect(daysOnMarket("2026-12-21", "2026-12-20")).toBeNull();
      expect(daysOnMarket(null, "2026-12-20")).toBeNull();
      expect(daysOnMarket(undefined, "2026-12-20")).toBeNull();
      expect(daysOnMarket("", "2026-12-20")).toBeNull();
      expect(daysOnMarket("not a date", "2026-12-20")).toBeNull();
    });

    it("labels it", () => {
      expect(daysOnMarketLabel(0)).toBe("Listed today");
      expect(daysOnMarketLabel(1)).toBe("1 day on market");
      expect(daysOnMarketLabel(12)).toBe("12 days on market");
      expect(daysOnMarketLabel(null)).toBeNull();
    });
  });

  describe("isNewListing", () => {
    afterEach(() => vi.useRealTimers());

    const cases = () => {
      expect(isNewListing("2026-12-20", "2026-12-20")).toBe(true); // today
      expect(isNewListing("2026-12-13", "2026-12-20")).toBe(true); // 7 days
      expect(isNewListing("2026-12-12", "2026-12-20")).toBe(false); // 8 days
      expect(isNewListing("2026-12-25", "2026-12-20")).toBe(false); // future: not on market yet
      expect(isNewListing(null, "2026-12-20")).toBe(false);
    };

    it("counts whole days from the market date", cases);

    it("doesn't depend on the clock it runs on", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-12-31T12:00:00Z"));
      cases();
      vi.setSystemTime(new Date("2026-12-15T00:00:00Z"));
      cases();
    });
  });

  it("shows the state as stored canonically", () => {
    const a = { addressLine1: "1 Main St", city: "Royston", postalCode: "30662" };
    expect(formatCityLine({ ...a, state: " georgia " })).toBe("Royston, GA 30662");
    expect(formatCityLine({ ...a, state: "al" })).toBe("Royston, AL 30662");
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

describe("cutAtWord and listingMetaDescription", () => {
  it("leaves text that fits untouched", () => {
    expect(cutAtWord("Three bedrooms on two acres.", 28)).toBe("Three bedrooms on two acres.");
    expect(listingMetaDescription("Short remarks.")).toBe("Short remarks.");
  });

  it("cuts at a word boundary, within the limit, ending in an ellipsis", () => {
    expect(cutAtWord("Three bedrooms on two acres.", 20)).toBe("Three bedrooms on…");
    const d = listingMetaDescription("Lovely farmhouse with a wraparound porch. ".repeat(10));
    expect(d.length).toBeLessThanOrEqual(160);
    expect(d.endsWith("…")).toBe(true);
    expect(d).not.toMatch(/[\s,.;:]…$/);
  });

  it("drops punctuation left before the ellipsis", () => {
    expect(cutAtWord("Updated kitchen, new roof, big yard", 18)).toBe("Updated kitchen…");
  });

  it("collapses whitespace and newlines in listing remarks", () => {
    expect(listingMetaDescription("  Big yard.\n\nNew   roof.\t ")).toBe("Big yard. New roof.");
    expect(listingMetaDescription("One\ntwo three four", 12)).toBe("One two…");
  });

  it("cuts a single long word rather than returning nothing", () => {
    expect(cutAtWord("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("formatDisplayPhone", () => {
  it("formats US numbers as xxx-xxx-xxxx", () => {
    for (const raw of [
      "8505723287",
      "850-572-3287",
      "(850) 572-3287",
      "+1 850 572 3287",
      "18505723287",
    ]) {
      expect(formatDisplayPhone(raw)).toBe("850-572-3287");
    }
  });

  it("is null when blank", () => {
    expect(formatDisplayPhone("")).toBeNull();
    expect(formatDisplayPhone("  ")).toBeNull();
    expect(formatDisplayPhone(null)).toBeNull();
  });

  it("leaves anything else as given", () => {
    expect(formatDisplayPhone("572-3287")).toBe("572-3287");
  });
});
