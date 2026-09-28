import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { maxDuration } from "./route";

// vercel.json's crons, as the preview link (Vercel Hobby) runs them. Hobby
// accepts only daily schedules (a sub-daily one fails the deployment) and
// may fire a daily cron at any minute within its scheduled hour.

type Cron = { path: string; schedule: string };
const { crons } = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: Cron[] };

/** The hour of a daily schedule ("m h * * *"), or null if it isn't one. */
function dailyHour(schedule: string): number | null {
  const m = schedule.trim().match(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
  return m && Number(m[1]) < 60 && Number(m[2]) < 24 ? Number(m[2]) : null;
}

const hourOf = (path: string) => {
  const cron = crons.find((c) => c.path === path);
  if (!cron) throw new Error(`no cron for ${path}`);
  return dailyHour(cron.schedule);
};

describe("vercel.json crons", () => {
  it("are all daily, so the Hobby preview deploys", () => {
    expect(crons.length).toBeGreaterThanOrEqual(3);
    for (const c of crons) expect(dailyHour(c.schedule), c.path).not.toBeNull();
  });

  it("put the purge in a later hour than the sync can still be running in", () => {
    const sync = hourOf("/api/cron/sync")!;
    const purge = hourOf("/api/cron/sync?purge=1")!;
    // The sync may start at hh:59 and run maxDuration past it, into the next
    // hour; the purge, firing anywhere in its own hour, must start after that.
    const syncCanRunUntil = sync * 60 + 59 + Math.ceil(maxDuration / 60);
    const gap = (((purge - sync) % 24) + 24) % 24;
    expect(sync * 60 + gap * 60).toBeGreaterThan(syncCanRunUntil);
  });
});
