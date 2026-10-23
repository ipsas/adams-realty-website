import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maxDuration } from "./route";

// vercel.json's crons, as Vercel Pro runs them: each fires at its scheduled
// minute. (Hobby accepts only daily schedules; a sub-daily one fails the
// deployment there.)

type Cron = { path: string; schedule: string };
const { crons } = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Cron[] };

const fields = (schedule: string) => schedule.trim().split(/\s+/);

/** The start minutes of "*\/N * * * *" ([0, N, 2N, …]), or null if it isn't one. */
function minuteStarts(schedule: string): number[] | null {
  const m = schedule.trim().match(/^\*\/(\d{1,2}) \* \* \* \*$/);
  const n = m ? Number(m[1]) : 0;
  if (n < 1 || n > 59) return null;
  return Array.from({ length: Math.ceil(60 / n) }, (_, i) => i * n);
}

/** The minute and hour of a daily schedule ("m h * * *"), or null if it isn't one. */
function dailyMinuteHour(schedule: string): { minute: number; hour: number } | null {
  const m = schedule.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  return m && Number(m[1]) < 60 && Number(m[2]) < 24
    ? { minute: Number(m[1]), hour: Number(m[2]) }
    : null;
}

/** The minute of an hourly schedule ("m * * * *"), or null if it isn't one. */
function hourlyMinute(schedule: string): number | null {
  const m = schedule.trim().match(/^(\d{1,2}) \* \* \* \*$/);
  return m && Number(m[1]) < 60 ? Number(m[1]) : null;
}

const scheduleOf = (path: string) => {
  const cron = crons.find((c) => c.path === path);
  if (!cron) throw new Error(`no cron for ${path}`);
  return cron.schedule;
};

describe("vercel.json crons", () => {
  it("have five fields each and cover the sync, the purge and the alerts", () => {
    for (const c of crons) expect(fields(c.schedule), c.path).toHaveLength(5);
    for (const path of ["/api/cron/sync", "/api/cron/sync?purge=1", "/api/cron/alerts"]) {
      expect(() => scheduleOf(path)).not.toThrow();
    }
  });

  it("sync the feed at least every 15 minutes", () => {
    const m = scheduleOf("/api/cron/sync").trim().match(/^\*\/(\d{1,2}) /);
    const n = m ? Number(m[1]) : NaN;
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(15);
    expect(60 % n).toBe(0);
  });

  it("purge daily, at a minute clear of every sync run", () => {
    const starts = minuteStarts(scheduleOf("/api/cron/sync"))!;
    const purge = dailyMinuteHour(scheduleOf("/api/cron/sync?purge=1"));
    expect(purge).not.toBeNull();
    const m = purge!.minute;
    // A sync may run maxDuration past its start; the purge must start after
    // the previous one can have ended, and end before the next one starts.
    const limit = Math.ceil(maxDuration / 60);
    const prev = Math.max(...starts.filter((s) => s <= m));
    const next = starts.find((s) => s > m) ?? starts[0] + 60;
    expect(m - prev).toBeGreaterThanOrEqual(limit);
    expect(next - m).toBeGreaterThanOrEqual(limit);
  });

  it("send alerts hourly, so instant alerts and the 7 a.m. summary go out within the hour", () => {
    expect(hourlyMinute(scheduleOf("/api/cron/alerts"))).not.toBeNull();
  });
});
