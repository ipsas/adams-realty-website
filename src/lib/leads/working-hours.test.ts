import { describe, expect, it } from "vitest";
import {
  addOfficeTime,
  followUpDate,
  formatOfficeDuration,
  isWaitingTooLong,
  marketToday,
  waitingLabel,
  WAIT_LIMIT_MS,
  workingCutoff,
  workingMsBetween,
} from "./working-hours";

const TZ = "America/New_York";
const HOUR = 3_600_000;
/** Eastern wall-clock time in October 2026 (EDT, UTC-4). 2026-10-02 is a Friday. */
const et = (day: string, time: string) => new Date(`${day}T${time}:00-04:00`);

describe("workingMsBetween", () => {
  it("counts only Monday to Friday, 9 to 5 Eastern", () => {
    expect(workingMsBetween(et("2026-09-29", "10:00"), et("2026-09-29", "11:30"), TZ)).toBe(
      1.5 * HOUR,
    );
    // Before opening and after closing count nothing.
    expect(workingMsBetween(et("2026-09-29", "06:00"), et("2026-09-29", "09:00"), TZ)).toBe(0);
    expect(workingMsBetween(et("2026-09-29", "17:00"), et("2026-09-29", "23:00"), TZ)).toBe(0);
    // Friday 4:30 pm to Monday 10:30 am: half an hour Friday, an hour and a half Monday.
    expect(workingMsBetween(et("2026-10-02", "16:30"), et("2026-10-05", "10:30"), TZ)).toBe(
      2 * HOUR,
    );
    // A whole week is 40 hours.
    expect(workingMsBetween(et("2026-09-28", "00:00"), et("2026-10-05", "00:00"), TZ)).toBe(
      40 * HOUR,
    );
  });

  it("is zero when the end isn't after the start", () => {
    const t = et("2026-09-29", "10:00");
    expect(workingMsBetween(t, t, TZ)).toBe(0);
    expect(workingMsBetween(t, new Date(t.getTime() - HOUR), TZ)).toBe(0);
  });

  it("follows the clocks across the end of daylight saving time", () => {
    // Sun Nov 1 2026 the clocks go back; Monday 9 am is 14:00 UTC, not 13:00.
    const fri = new Date("2026-10-30T20:00:00Z"); // Fri 4 pm EDT
    const mon = new Date("2026-11-02T15:00:00Z"); // Mon 10 am EST
    expect(workingMsBetween(fri, mon, TZ)).toBe(2 * HOUR);
  });
});

describe("workingCutoff", () => {
  it("is 2 office hours back, skipping nights and weekends", () => {
    expect(workingCutoff(et("2026-09-29", "14:00"), WAIT_LIMIT_MS, TZ)).toEqual(
      et("2026-09-29", "12:00"),
    );
    // Monday 10 am: one hour Monday, one hour back into Friday.
    expect(workingCutoff(et("2026-10-05", "10:00"), WAIT_LIMIT_MS, TZ)).toEqual(
      et("2026-10-02", "16:00"),
    );
    // Saturday: the last two hours of Friday.
    expect(workingCutoff(et("2026-10-03", "12:00"), WAIT_LIMIT_MS, TZ)).toEqual(
      et("2026-10-02", "15:00"),
    );
  });

  it("agrees with workingMsBetween: at the cutoff the wait is exactly the limit, just after it less", () => {
    for (const now of [
      et("2026-09-29", "09:30"),
      et("2026-10-03", "08:00"),
      et("2026-10-05", "16:59"),
      new Date("2026-11-02T15:30:00Z"),
    ]) {
      const cutoff = workingCutoff(now, WAIT_LIMIT_MS, TZ);
      expect(workingMsBetween(cutoff, now, TZ)).toBe(WAIT_LIMIT_MS);
      expect(workingMsBetween(new Date(cutoff.getTime() + 60_000), now, TZ)).toBeLessThan(
        WAIT_LIMIT_MS,
      );
    }
  });
});

describe("addOfficeTime", () => {
  it("walks forward through office hours only", () => {
    expect(addOfficeTime(et("2026-10-02", "16:30"), 2 * HOUR, TZ)).toEqual(
      et("2026-10-05", "10:30"),
    );
    expect(addOfficeTime(et("2026-10-03", "12:00"), 40 * 60_000, TZ)).toEqual(
      et("2026-10-05", "09:40"),
    );
    for (const from of [et("2026-09-29", "08:00"), et("2026-10-02", "16:59")]) {
      expect(workingMsBetween(from, addOfficeTime(from, 3 * HOUR, TZ), TZ)).toBe(3 * HOUR);
    }
  });
});

describe("isWaitingTooLong", () => {
  it("flags a lead after 2 office hours, not after 2 clock hours overnight", () => {
    const now = et("2026-09-30", "09:30");
    expect(isWaitingTooLong(et("2026-09-29", "16:00"), now, TZ)).toBe(false); // 1.5 h
    expect(isWaitingTooLong(et("2026-09-29", "15:00"), now, TZ)).toBe(true); // 2.5 h
    // Friday evening to Monday 10:30: under 2 office hours.
    expect(isWaitingTooLong(et("2026-10-02", "18:00"), et("2026-10-05", "10:30"), TZ)).toBe(false);
    expect(isWaitingTooLong(et("2026-10-02", "18:00"), et("2026-10-05", "11:00"), TZ)).toBe(true);
  });
});

describe("labels", () => {
  it("says how long the lead has waited on the clock", () => {
    const now = et("2026-10-05", "10:00");
    expect(waitingLabel(et("2026-10-01", "09:00"), now)).toBe("Waiting 4 days");
    expect(waitingLabel(et("2026-10-04", "09:00"), now)).toBe("Waiting 1 day");
    expect(waitingLabel(et("2026-10-05", "05:00"), now)).toBe("Waiting 5 hours");
    expect(waitingLabel(et("2026-10-05", "09:00"), now)).toBe("Waiting 1 hour");
    expect(waitingLabel(et("2026-10-05", "09:40"), now)).toBe("Waiting 20 min");
  });

  it("formats office time", () => {
    expect(formatOfficeDuration(20_000)).toBe("under a minute");
    expect(formatOfficeDuration(25 * 60_000)).toBe("25 min");
    expect(formatOfficeDuration(100 * 60_000)).toBe("1 h 40 min");
    expect(formatOfficeDuration(3 * HOUR)).toBe("3 h");
    expect(formatOfficeDuration(20 * HOUR)).toBe("2.5 office days");
  });
});

describe("follow-up dates", () => {
  it("count calendar days from today in the market's time zone", () => {
    // 11 pm Eastern on Tue Sep 29 is already Wednesday in UTC.
    const now = new Date("2026-09-30T03:00:00Z");
    expect(marketToday(now, TZ)).toBe("2026-09-29");
    expect(followUpDate("tomorrow", now, TZ)).toBe("2026-09-30");
    expect(followUpDate("in3", now, TZ)).toBe("2026-10-02");
    expect(followUpDate("week", now, TZ)).toBe("2026-10-06");
  });
});
