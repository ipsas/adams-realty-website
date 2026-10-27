import { describe, expect, it } from "vitest";
import {
  alertWindows,
  EVENT_SETTLE_MS,
  inWindow,
  isDue,
  LISTING_SETTLE_MS,
  type AlertFrequency,
  type Window,
} from "./schedule";

// Four weeks of the hourly alerts cron (Oct 5 to Nov 2 2026, through the end
// of DST on Nov 1), after the one-time activation (email-batch.ts
// `activateEmailAlerts`). Every search keeps its own cadence window: consecutive
// windows tile with no lost and no repeated minute, and they are exactly the
// windows c73994b (before the email guard) produced, including when the cron
// is down or the batch-mail guard defers a run.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** c73994b's alertWindows, copied: the reference these windows must match. */
function alertWindowsC73994b(input: { createdAt: Date; lastRunAt: Date | null; now: Date }) {
  const MAX_WINDOW_MS = 8 * DAY;
  const now = input.now.getTime();
  const floor = now - MAX_WINDOW_MS;
  const created = input.createdAt.getTime();
  const last = (input.lastRunAt ?? input.createdAt).getTime();
  const trailing = (settle: number): Window => ({
    start: new Date(Math.max(created, last - settle, floor)),
    end: new Date(now - settle),
  });
  return { listings: trailing(LISTING_SETTLE_MS), events: trailing(EVENT_SETTLE_MS) };
}

/** The activation UPDATE: greatest(coalesce(last, created), now() - 24 hours). */
const activate = (createdAt: Date, last: Date | null, now: Date) =>
  new Date(Math.max((last ?? createdAt).getTime(), now.getTime() - DAY));

/** Hourly cron at :00:05 for four weeks, minus the runs `skip` drops. */
function hourlyRuns(skip: (at: Date) => boolean = () => false): Date[] {
  const t0 = new Date("2026-10-05T00:00:05Z").getTime();
  return Array.from({ length: 28 * 24 }, (_, i) => new Date(t0 + i * HOUR)).filter(
    (at) => !skip(at),
  );
}

const between = (from: string, to: string) => (at: Date) =>
  at >= new Date(from) && at < new Date(to);

type Run = { listings: Window; events: Window };

/** One subscription through `runs`, with each schedule; the first run activates. */
function simulate(frequency: AlertFrequency, runs: Date[], createdAt: Date) {
  const out = { current: [] as Run[], reference: [] as Run[] };
  let last: Date | null = activate(createdAt, null, runs[0]);
  for (const now of runs) {
    if (!isDue(frequency, last ?? createdAt, now)) continue;
    out.current.push(alertWindows({ createdAt, lastRunAt: last, now }));
    out.reference.push(alertWindowsC73994b({ createdAt, lastRunAt: last, now }));
    last = now;
  }
  return out;
}

/** Minutes between consecutive windows that no window covered, and minutes covered twice. */
function coverage(runs: Run[], kind: keyof Run) {
  let lost = 0;
  let repeated = 0;
  for (let i = 1; i < runs.length; i++) {
    const gap = runs[i][kind].start.getTime() - runs[i - 1][kind].end.getTime();
    if (gap > 0) lost += gap;
    else repeated -= gap;
  }
  return { lost: lost / MINUTE, repeated: repeated / MINUTE };
}

const CREATED = new Date("2026-09-01T00:00:00Z");

const CASES: [string, AlertFrequency, Date[]][] = [
  ["daily", "daily", hourlyRuns()],
  ["weekly", "weekly", hourlyRuns()],
  ["instant", "instant", hourlyRuns()],
  [
    "instant, cron down 30 h",
    "instant",
    hourlyRuns(between("2026-10-10T00:00:00Z", "2026-10-11T06:00:00Z")),
  ],
  [
    "daily, cron down 30 h",
    "daily",
    hourlyRuns(between("2026-10-10T00:00:00Z", "2026-10-11T06:00:00Z")),
  ],
  // Run cap: Oct 14's 7 a.m. EDT run deferred this search to 8 a.m.
  [
    "daily, run-cap deferral",
    "daily",
    hourlyRuns(between("2026-10-14T11:00:00Z", "2026-10-14T12:00:00Z")),
  ],
  // Budget used up from 7:00 until the UTC day turns at 20:00 EDT.
  [
    "daily, budget deferral",
    "daily",
    hourlyRuns(between("2026-10-14T11:00:00Z", "2026-10-15T00:00:00Z")),
  ],
  [
    "weekly, budget deferral",
    "weekly",
    hourlyRuns(between("2026-10-19T11:00:00Z", "2026-10-20T00:00:00Z")),
  ],
];

describe("alert windows over four weeks of hourly runs", () => {
  it.each(CASES)("%s: no lost minutes, identical to c73994b", (_name, frequency, runs) => {
    const { current, reference } = simulate(frequency, runs, CREATED);
    expect(current.length).toBeGreaterThan(frequency === "weekly" ? 3 : 25);
    expect(current).toEqual(reference);
    for (const kind of ["listings", "events"] as const)
      expect(coverage(current, kind), kind).toEqual({ lost: 0, repeated: 0 });
  });

  it("a weekly email covers the whole week, not just its last day", () => {
    const { current } = simulate("weekly", hourlyRuns(), CREATED);
    // Monday 7 a.m. to Monday 7 a.m.: an hour longer across the end of DST.
    for (const w of current.slice(1))
      expect(w.listings.end.getTime() - w.listings.start.getTime()).toBeGreaterThanOrEqual(7 * DAY);
  });

  it("the first window after activation reaches back 24 hours, not to the backlog", () => {
    const runs = hourlyRuns();
    const { current } = simulate("instant", runs, CREATED);
    expect(current[0].listings.start).toEqual(
      new Date(runs[0].getTime() - DAY - LISTING_SETTLE_MS),
    );
  });
});

describe("saved-home changes over four weeks", () => {
  // Price and status events every 37 minutes; a home is a candidate (homes.ts
  // findHomeCandidates) when an event falls in its event window, and the claim
  // moves its last-notified time to the run.
  const events = Array.from(
    { length: Math.floor((28 * DAY) / (37 * MINUTE)) },
    (_, i) => new Date(new Date("2026-10-05T00:00:00Z").getTime() + i * 37 * MINUTE),
  );

  it.each([
    ["hourly", hourlyRuns()],
    ["cron down 30 h", hourlyRuns(between("2026-10-10T00:00:00Z", "2026-10-11T06:00:00Z"))],
    ["budget deferral", hourlyRuns(between("2026-10-14T11:00:00Z", "2026-10-15T00:00:00Z"))],
  ] as const)("%s: every settled event is emailed exactly once", (_name, runs) => {
    const savedAt = new Date("2026-09-20T00:00:00Z");
    let last: Date | null = activate(savedAt, null, runs[0]);
    const firstStart = alertWindows({ createdAt: savedAt, lastRunAt: last, now: runs[0] }).events
      .start;
    const emailed = new Map<number, number>();
    let end = firstStart;
    for (const now of runs) {
      const w = alertWindows({ createdAt: savedAt, lastRunAt: last, now }).events;
      const reference = alertWindowsC73994b({ createdAt: savedAt, lastRunAt: last, now }).events;
      expect(w).toEqual(reference);
      const inside = events.filter((e) => inWindow(e, w));
      if (!inside.length) continue;
      for (const e of inside) emailed.set(e.getTime(), (emailed.get(e.getTime()) ?? 0) + 1);
      last = now;
      end = w.end;
    }
    const due = events.filter((e) => e > firstStart && e <= end);
    expect(due.length).toBeGreaterThan(1000);
    expect(due.filter((e) => emailed.get(e.getTime()) !== 1)).toEqual([]);
  });
});
