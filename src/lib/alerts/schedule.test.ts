import { describe, expect, it } from "vitest";
import {
  alertWindows,
  CLAIM_LEASE_MS,
  currentSlot,
  EVENT_SETTLE_MS,
  inWindow,
  isDue,
  localClock,
  MAX_WINDOW_MS,
} from "./schedule";

const TZ = "America/New_York";
const at = (iso: string) => new Date(iso);

describe("localClock", () => {
  it("reads the wall clock in the market time zone", () => {
    // 2am UTC on Tuesday Sep 29 is still 10pm Monday in Atlanta (EDT, UTC-4).
    expect(localClock(at("2026-09-29T02:00:00Z"), TZ)).toEqual({
      date: "2026-09-28",
      hour: 22,
      isoWeekday: 1,
    });
    expect(localClock(at("2026-09-27T16:00:00Z"), TZ).isoWeekday).toBe(7); // Sunday
  });
});

describe("currentSlot", () => {
  it("is today 7am local for daily digests, null before 7am", () => {
    expect(currentSlot("daily", at("2026-09-25T10:59:00Z"), TZ)).toBeNull(); // 6:59am EDT
    expect(currentSlot("daily", at("2026-09-25T11:00:00Z"), TZ)?.toISOString()).toBe(
      "2026-09-25T11:00:00.000Z",
    );
    expect(currentSlot("daily", at("2026-09-26T03:30:00Z"), TZ)?.toISOString()).toBe(
      "2026-09-25T11:00:00.000Z", // 11:30pm Friday local
    );
  });

  it("is this week's Monday 7am local for weekly digests", () => {
    // Friday Sep 25 → Monday Sep 21.
    expect(currentSlot("weekly", at("2026-09-25T15:00:00Z"), TZ)?.toISOString()).toBe(
      "2026-09-21T11:00:00.000Z",
    );
    // Sunday evening still belongs to the week that started Monday.
    expect(currentSlot("weekly", at("2026-09-27T22:00:00Z"), TZ)?.toISOString()).toBe(
      "2026-09-21T11:00:00.000Z",
    );
    // Monday 7am starts a new week.
    expect(currentSlot("weekly", at("2026-09-28T11:05:00Z"), TZ)?.toISOString()).toBe(
      "2026-09-28T11:00:00.000Z",
    );
  });

  it("follows daylight saving time", () => {
    // Monday Nov 2, 2026 is the first weekday on EST (UTC-5): 7am = 12:00Z.
    expect(currentSlot("weekly", at("2026-11-02T11:30:00Z"), TZ)).toBeNull(); // 6:30am EST
    expect(currentSlot("weekly", at("2026-11-02T12:00:00Z"), TZ)?.toISOString()).toBe(
      "2026-11-02T12:00:00.000Z",
    );
    // Sunday Mar 8, 2026 springs forward; 7am that day is EDT (UTC-4).
    expect(currentSlot("daily", at("2026-03-08T11:00:00Z"), TZ)?.toISOString()).toBe(
      "2026-03-08T11:00:00.000Z",
    );
  });
});

describe("isDue", () => {
  const monday8am = at("2026-09-28T12:00:00Z");

  it("sends instant alerts every run and never sends when off", () => {
    expect(isDue("instant", at("2026-09-28T11:59:00Z"), monday8am, TZ)).toBe(true);
    expect(isDue("off", at("2020-01-01T00:00:00Z"), monday8am, TZ)).toBe(false);
  });

  it("sends a daily digest once per local day, not before 7am", () => {
    const yesterday = at("2026-09-27T11:05:00Z");
    expect(isDue("daily", yesterday, at("2026-09-28T10:30:00Z"), TZ)).toBe(false); // 6:30am
    expect(isDue("daily", yesterday, at("2026-09-28T11:05:00Z"), TZ)).toBe(true); // 7:05am
    // Already sent at 7:05 today → not again at 8, or at 11pm.
    const today = at("2026-09-28T11:05:00Z");
    expect(isDue("daily", today, monday8am, TZ)).toBe(false);
    expect(isDue("daily", today, at("2026-09-29T03:00:00Z"), TZ)).toBe(false);
  });

  it("waits until tomorrow morning for a search saved after 7am", () => {
    const savedAt = at("2026-09-28T13:00:00Z"); // 9am Monday
    expect(isDue("daily", savedAt, at("2026-09-28T14:00:00Z"), TZ)).toBe(false);
    expect(isDue("daily", savedAt, at("2026-09-29T11:00:00Z"), TZ)).toBe(true);
  });

  it("catches up after missed runs, still not before 7am", () => {
    const twoDaysAgo = at("2026-09-26T11:05:00Z");
    expect(isDue("daily", twoDaysAgo, at("2026-09-28T07:00:00Z"), TZ)).toBe(false); // 3am
    expect(isDue("daily", twoDaysAgo, at("2026-09-28T13:00:00Z"), TZ)).toBe(true);
  });

  it("sends a weekly digest on Monday mornings", () => {
    const lastMonday = at("2026-09-21T11:05:00Z");
    expect(isDue("weekly", lastMonday, at("2026-09-27T15:00:00Z"), TZ)).toBe(false); // Sunday
    expect(isDue("weekly", lastMonday, at("2026-09-28T10:00:00Z"), TZ)).toBe(false); // Mon 6am
    expect(isDue("weekly", lastMonday, at("2026-09-28T11:00:00Z"), TZ)).toBe(true); // Mon 7am
    // Sent Monday → nothing Tuesday through Sunday.
    const sent = at("2026-09-28T11:01:00Z");
    expect(isDue("weekly", sent, at("2026-09-29T15:00:00Z"), TZ)).toBe(false);
    expect(isDue("weekly", sent, at("2026-10-04T23:00:00Z"), TZ)).toBe(false);
    // Monday's runs all failed → Tuesday's first run after 7am catches up.
    expect(isDue("weekly", lastMonday, at("2026-09-29T11:00:00Z"), TZ)).toBe(true);
  });

  it("gives a search saved mid-week its first weekly digest the next Monday", () => {
    const savedWednesday = at("2026-09-23T18:00:00Z");
    expect(isDue("weekly", savedWednesday, at("2026-09-25T15:00:00Z"), TZ)).toBe(false);
    expect(isDue("weekly", savedWednesday, at("2026-09-28T11:00:00Z"), TZ)).toBe(true);
  });
});

describe("alertWindows", () => {
  const createdAt = at("2026-09-20T12:00:00Z");

  it("starts at creation for the first run", () => {
    const now = at("2026-09-21T11:00:00Z");
    const w = alertWindows({ createdAt, lastRunAt: null, now });
    expect(w.listings).toEqual({ start: createdAt, end: now });
    expect(w.events).toEqual({ start: createdAt, end: new Date(now.getTime() - EVENT_SETTLE_MS) });
  });

  it("tiles consecutive runs with no gaps or overlaps", () => {
    const run1 = at("2026-09-21T11:00:00Z");
    const run2 = at("2026-09-21T12:00:00Z");
    const w1 = alertWindows({ createdAt, lastRunAt: null, now: run1 });
    const w2 = alertWindows({ createdAt, lastRunAt: run1, now: run2 });
    expect(w2.listings.start).toEqual(w1.listings.end);
    expect(w2.events.start).toEqual(w1.events.end);
    // An event recorded late (stamped 10 minutes before run 1) still falls in run 2's window.
    const lateEvent = new Date(run1.getTime() - 10 * 60_000);
    expect(inWindow(lateEvent, w1.events)).toBe(false);
    expect(inWindow(lateEvent, w2.events)).toBe(true);
  });

  it("never covers events from before the subscription existed", () => {
    const now = at("2026-09-20T12:20:00Z"); // 20 minutes after creation
    const w1 = alertWindows({ createdAt, lastRunAt: null, now });
    expect(w1.events.end < w1.events.start).toBe(true); // empty
    const w2 = alertWindows({ createdAt, lastRunAt: now, now: at("2026-09-20T13:20:00Z") });
    expect(w2.events.start).toEqual(createdAt);
  });

  it("caps how far back a window reaches", () => {
    const now = at("2026-09-25T12:00:00Z");
    const w = alertWindows({ createdAt: at("2026-01-01T00:00:00Z"), lastRunAt: null, now });
    expect(now.getTime() - w.listings.start.getTime()).toBe(MAX_WINDOW_MS);
    expect(now.getTime() - w.events.start.getTime()).toBe(MAX_WINDOW_MS);
  });

  it("treats windows as half-open", () => {
    const w = { start: at("2026-09-21T11:00:00Z"), end: at("2026-09-21T12:00:00Z") };
    expect(inWindow(w.start, w)).toBe(false);
    expect(inWindow(w.end, w)).toBe(true);
  });

  it("uses a claim lease shorter than the hourly cron interval", () => {
    expect(CLAIM_LEASE_MS).toBeLessThan(60 * 60_000);
  });
});
