import { site } from "@/config/site";
import { localClock } from "@/lib/alerts/schedule";
import { zonedDateTime } from "@/lib/time";

/**
 * Office time for lead response: Monday to Friday, 9 a.m. to 5 p.m. in the
 * market's time zone (America/New_York, so DST is handled). Pure: `now` is
 * always passed in.
 *
 * A new lead is "waiting too long" once it has waited `WAIT_LIMIT_MS` (2
 * hours, owner decision) of office time: one that arrives Friday at 4:30 p.m.
 * becomes overdue Monday at 10:30 a.m., not Friday night.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const OFFICE_OPENS = "09:00";
export const OFFICE_CLOSES = "17:00";
/** How long a new lead may wait, in office time, before it needs attention. */
export const WAIT_LIMIT_MS = 2 * HOUR;
/** Plain wording of the rule, for the dashboard and the morning email. */
export const WAIT_RULE = "2 office hours (Mon–Fri, 9–5)";

/** YYYY-MM-DD ± days, on the calendar (no time zone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Today's date (YYYY-MM-DD) in the market's time zone. */
export function marketToday(now: Date, timeZone: string = site.market.timeZone): string {
  return localClock(now, timeZone).date;
}

/** 1 = Monday … 7 = Sunday, for a calendar date. */
function isoWeekday(date: string): number {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** The office's open hours on a local calendar day, as instants; null at the weekend. */
function officeHours(date: string, timeZone: string): { start: number; end: number } | null {
  if (isoWeekday(date) > 5) return null;
  return {
    start: zonedDateTime(date, OFFICE_OPENS, timeZone)!.getTime(),
    end: zonedDateTime(date, OFFICE_CLOSES, timeZone)!.getTime(),
  };
}

/** Office time (ms) between two instants; 0 when `to` isn't after `from`. */
export function workingMsBetween(
  from: Date,
  to: Date,
  timeZone: string = site.market.timeZone,
): number {
  const a = from.getTime();
  const b = to.getTime();
  if (b <= a) return 0;
  let total = 0;
  const last = marketToday(to, timeZone);
  for (let day = marketToday(from, timeZone); day <= last; day = addDays(day, 1)) {
    const h = officeHours(day, timeZone);
    if (h) total += Math.max(0, Math.min(b, h.end) - Math.max(a, h.start));
  }
  return total;
}

/**
 * The latest instant from which `ms` of office time has passed by `now`: a lead
 * created at or before it has waited at least that long. Lets the database pick
 * overdue leads with a plain `created_at <= cutoff`.
 */
export function workingCutoff(
  now: Date,
  ms: number = WAIT_LIMIT_MS,
  timeZone: string = site.market.timeZone,
): Date {
  const t = now.getTime();
  let remaining = ms;
  let day = marketToday(now, timeZone);
  // About ten years of days; the bound only guards against a huge `ms`.
  for (let i = 0; i < 3_700; i++, day = addDays(day, -1)) {
    const h = officeHours(day, timeZone);
    if (!h || h.start >= t) continue;
    const end = Math.min(t, h.end);
    if (end - h.start >= remaining) return new Date(end - remaining);
    remaining -= end - h.start;
  }
  return new Date(t - 10 * 365 * DAY);
}

/** True once a lead created at `createdAt` has waited longer than the limit, in office time. */
export function isWaitingTooLong(createdAt: Date, now: Date, timeZone?: string): boolean {
  return createdAt <= workingCutoff(now, WAIT_LIMIT_MS, timeZone);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Waiting 4 days" / "Waiting 5 hours" / "Waiting 20 min": clock time since the lead arrived. */
export function waitingLabel(createdAt: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - createdAt.getTime());
  if (ms >= DAY) return `Waiting ${plural(Math.floor(ms / DAY), "day")}`;
  if (ms >= HOUR) return `Waiting ${plural(Math.floor(ms / HOUR), "hour")}`;
  return `Waiting ${Math.max(1, Math.floor(ms / MINUTE))} min`;
}

/** A span of office time: "under a minute", "25 min", "1 h 40 min", "3 h", "2.5 office days". */
export function formatOfficeDuration(ms: number): string {
  if (ms < MINUTE) return "under a minute";
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  if (ms < 16 * HOUR) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  const days = Math.round((ms / (8 * HOUR)) * 10) / 10;
  return `${days} office days`;
}

export type FollowUpPreset = "tomorrow" | "in3" | "week";

export const FOLLOW_UP_PRESETS: { value: FollowUpPreset; label: string; days: number }[] = [
  { value: "tomorrow", label: "Tomorrow", days: 1 },
  { value: "in3", label: "In 3 days", days: 3 },
  { value: "week", label: "Next week", days: 7 },
];

/** The follow-up date a quick button sets, counted in calendar days from the market's today. */
export function followUpDate(
  preset: FollowUpPreset,
  now: Date,
  timeZone: string = site.market.timeZone,
): string {
  const days = FOLLOW_UP_PRESETS.find((p) => p.value === preset)!.days;
  return addDays(marketToday(now, timeZone), days);
}

/** "Mon, Sep 28" for a calendar date (YYYY-MM-DD). */
export function formatDay(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** The instant `ms` of office time after `from` (e.g. when a lead arriving then becomes overdue). */
export function addOfficeTime(
  from: Date,
  ms: number,
  timeZone: string = site.market.timeZone,
): Date {
  const t = from.getTime();
  let remaining = ms;
  let day = marketToday(from, timeZone);
  for (let i = 0; i < 3_700; i++, day = addDays(day, 1)) {
    const h = officeHours(day, timeZone);
    if (!h || h.end <= t) continue;
    const start = Math.max(t, h.start);
    if (h.end - start >= remaining) return new Date(start + remaining);
    remaining -= h.end - start;
  }
  return new Date(t + 10 * 365 * DAY);
}
