import { describe, expect, it } from "vitest";
import { marketDateDaysAgo, upcomingDays, zonedDateTime } from "./time";

describe("zonedDateTime", () => {
  it("converts Eastern wall-clock time to UTC across DST", () => {
    // EDT (UTC-4) in October, EST (UTC-5) in December.
    expect(zonedDateTime("2026-10-03", "14:30", "America/New_York")?.toISOString()).toBe(
      "2026-10-03T18:30:00.000Z",
    );
    expect(zonedDateTime("2026-12-05", "09:00", "America/New_York")?.toISOString()).toBe(
      "2026-12-05T14:00:00.000Z",
    );
  });

  it("rejects malformed input", () => {
    expect(zonedDateTime("10/03/2026", "14:30")).toBeNull();
    expect(zonedDateTime("2026-10-03", "2pm")).toBeNull();
  });
});

describe("upcomingDays", () => {
  it("lists the next days in the market time zone", () => {
    // 11pm Eastern on Sep 25 is already Sep 26 in UTC; "tomorrow" is still Sep 26 locally.
    const now = new Date("2026-09-26T03:00:00Z");
    expect(upcomingDays(2, now, "America/New_York")).toEqual(["2026-09-26", "2026-09-27"]);
  });

  // Labels as the tour strip renders them: the YYYY-MM-DD read at UTC.
  const label = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    });

  it.each([
    // 12:01 AM EDT Oct 31, the day before fall back.
    ["2026-10-31T04:01:00Z", "2026-11-01", "Sun, Nov 1"],
    // 12:01 AM EDT Nov 1, the fall-back day itself.
    ["2026-11-01T04:01:00Z", "2026-11-02", "Mon, Nov 2"],
    // 12:01 AM EST Mar 13, the day before spring forward.
    ["2027-03-13T05:01:00Z", "2027-03-14", "Sun, Mar 14"],
    // 12:01 AM EST Mar 14, the spring-forward day itself.
    ["2027-03-14T05:01:00Z", "2027-03-15", "Mon, Mar 15"],
    // 11:30 PM EST Nov 1 is already Nov 2 in UTC; tomorrow is still Nov 2 locally.
    ["2026-11-02T04:30:00Z", "2026-11-02", "Mon, Nov 2"],
  ])("steps by New York calendar day from %s", (iso, first, firstLabel) => {
    const days = upcomingDays(7, new Date(iso), "America/New_York");
    expect(days).toHaveLength(7);
    expect(new Set(days).size).toBe(7);
    expect(days[0]).toBe(first);
    days.forEach((d, i) => {
      const expected = new Date(Date.parse(`${first}T00:00:00Z`) + i * 86_400_000);
      expect(d).toBe(expected.toISOString().slice(0, 10));
    });
    expect(label(days[0])).toBe(firstLabel);
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const start = weekdays.indexOf(firstLabel.slice(0, 3));
    expect(days.map((d) => label(d).slice(0, 3))).toEqual(
      Array.from({ length: 7 }, (_, i) => weekdays[(start + i) % 7]),
    );
  });
});

describe("marketDateDaysAgo", () => {
  it("counts back from the market's calendar date, not the UTC one", () => {
    // 10pm EDT on Oct 26 is already Oct 27 in UTC.
    const now = new Date("2026-10-27T02:00:00Z");
    expect(marketDateDaysAgo(0, now, "America/New_York")).toBe("2026-10-26");
    expect(marketDateDaysAgo(365, now, "America/New_York")).toBe("2025-10-26");
    expect(marketDateDaysAgo(365, new Date("2026-10-27T04:30:00Z"), "America/New_York")).toBe(
      "2025-10-27",
    );
  });
});
