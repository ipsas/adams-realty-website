import { site } from "@/config/site";
import { zonedDateTime } from "@/lib/time";

/**
 * When alert emails go out and which slice of time each one covers. Pure —
 * `now` is always passed in, so every rule here is unit-tested.
 *
 * Saved-search frequencies, evaluated in the market's time zone
 * (America/New_York, so DST is handled):
 *
 * - `instant`: every cron run (the cron is hourly).
 * - `daily`:   once per local day, at the first run at or after 7:00am.
 * - `weekly`:  once per week, at the first run at or after 7:00am Monday.
 *              If every Monday run failed, the next run after 7:00am that
 *              week catches up (weeks run Monday–Sunday).
 * - `off`:     never.
 *
 * A search is due when it hasn't been evaluated since the current slot
 * (today 7:00am, or this week's Monday 7:00am) and it's past 7:00am now. Its
 * last evaluation is `last_alerted_at`, or its creation time if it has never
 * run, so a search saved at 9am gets its first daily digest tomorrow morning
 * instead of a near-empty one an hour later.
 */

export type AlertFrequency = "instant" | "daily" | "weekly" | "off";

/** Local hour (24h) at which daily and weekly digests start going out. */
export const SEND_HOUR = 7;

const MINUTE = 60_000;
const DAY = 86_400_000;

/** A window never reaches back further than this — e.g. after alerts were off or the cron was down. */
export const MAX_WINDOW_MS = 8 * DAY;

/**
 * Listing events (price cuts, status changes) are stamped with the MLS's own
 * time, which can be a few minutes older than when our sync records them.
 * Event windows therefore trail `now` by this much, so an event that arrives
 * late still lands in a window instead of falling between two runs.
 */
export const EVENT_SETTLE_MS = 30 * MINUTE;

/** A row processed less than this long ago can't be claimed again — overlapping runs never double-send. */
export const CLAIM_LEASE_MS = 10 * MINUTE;

type LocalClock = {
  /** YYYY-MM-DD in the given time zone. */
  date: string;
  hour: number;
  /** 1 = Monday … 7 = Sunday. */
  isoWeekday: number;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function localClock(at: Date, timeZone: string = site.market.timeZone): LocalClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    isoWeekday: WEEKDAYS.indexOf(get("weekday")) + 1,
  };
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The start of the current send slot for a digest frequency: today 7:00am
 * (daily) or this week's Monday 7:00am (weekly), local time. Null before
 * 7:00am local — digests never go out in the middle of the night.
 */
export function currentSlot(
  frequency: "daily" | "weekly",
  now: Date,
  timeZone: string = site.market.timeZone,
): Date | null {
  const clock = localClock(now, timeZone);
  if (clock.hour < SEND_HOUR) return null;
  const date = frequency === "weekly" ? addDays(clock.date, 1 - clock.isoWeekday) : clock.date;
  return zonedDateTime(date, `${String(SEND_HOUR).padStart(2, "0")}:00`, timeZone);
}

/** Whether a saved search should be evaluated on this run. `lastRunAt` = last_alerted_at ?? created_at. */
export function isDue(
  frequency: AlertFrequency,
  lastRunAt: Date,
  now: Date,
  timeZone: string = site.market.timeZone,
): boolean {
  if (frequency === "off") return false;
  if (frequency === "instant") return true;
  const slot = currentSlot(frequency, now, timeZone);
  return slot !== null && lastRunAt < slot;
}

export type Window = { start: Date; end: Date };

/**
 * The half-open windows `(start, end]` one evaluation covers:
 *
 * - `listings`: new listings, by when we first recorded them (`created_at`),
 *   from the last run (or creation) up to now.
 * - `events`: price cuts and status changes, trailing by EVENT_SETTLE_MS.
 *
 * Consecutive runs tile exactly: each run stores `now` as its last-run time,
 * and the next run starts where this one ended, so nothing is sent twice or
 * skipped. Neither window starts before the subscription existed (for events;
 * listings start at creation anyway) or reaches back more than MAX_WINDOW_MS.
 */
export function alertWindows(input: { createdAt: Date; lastRunAt: Date | null; now: Date }): {
  listings: Window;
  events: Window;
} {
  const now = input.now.getTime();
  const floor = now - MAX_WINDOW_MS;
  const last = (input.lastRunAt ?? input.createdAt).getTime();
  return {
    listings: { start: new Date(Math.max(last, floor)), end: new Date(now) },
    events: {
      start: new Date(Math.max(input.createdAt.getTime(), last - EVENT_SETTLE_MS, floor)),
      end: new Date(now - EVENT_SETTLE_MS),
    },
  };
}

/** True when `at` falls inside the half-open window `(start, end]`. */
export function inWindow(at: Date, w: Window): boolean {
  return at > w.start && at <= w.end;
}
