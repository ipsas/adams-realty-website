import { describe, expect, it } from "vitest";
import { upcomingDays, zonedDateTime } from "./time";

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
});
