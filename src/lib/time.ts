import { site } from "@/config/site";

/** Offset (minutes east of UTC) of `timeZone` at the given instant. */
function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** "2026-10-03" + "14:30" in the market's time zone → the UTC instant. */
export function zonedDateTime(
  date: string,
  time: string,
  timeZone: string = site.market.timeZone,
): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const naive = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  // Two passes handle instants near a DST transition.
  let result = new Date(naive.getTime() - offsetMinutes(naive, timeZone) * 60_000);
  result = new Date(naive.getTime() - offsetMinutes(result, timeZone) * 60_000);
  return result;
}

/** The next `count` calendar days (YYYY-MM-DD) in the market's time zone, starting tomorrow. */
export function upcomingDays(
  count: number,
  now: Date = new Date(),
  timeZone: string = site.market.timeZone,
): string[] {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return Array.from({ length: count }, (_, i) =>
    fmt.format(new Date(now.getTime() + (i + 1) * 86_400_000)),
  );
}

/**
 * The market's calendar date (YYYY-MM-DD in `site.market.timeZone`) `days` days
 * before `now`: a window of exactly that many local days, whatever the UTC date or DST.
 */
export function marketDateDaysAgo(
  days: number,
  now: Date = new Date(),
  timeZone: string = site.market.timeZone,
): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  // Calendar math on the local date, at UTC midnight: no DST in it.
  const today = Date.UTC(part("year"), part("month") - 1, part("day"));
  return new Date(today - days * 86_400_000).toISOString().slice(0, 10);
}
