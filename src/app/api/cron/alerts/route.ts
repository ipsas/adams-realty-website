import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { runAlerts } from "@/lib/alerts/run";
import { isCronAuthorized } from "@/lib/cron-auth";
import { pruneRateLimits } from "@/lib/rate-limit-db";

export const maxDuration = 300;

/**
 * Saved-search and saved-home email alerts. Vercel Cron calls this hourly
 * with `Authorization: Bearer $CRON_SECRET` (see vercel.json); frequencies
 * (instant/daily/weekly) are decided per search in src/lib/alerts/schedule.ts.
 * Safe to call more often or re-run — nothing is sent twice. Work not started
 * within ~4 minutes is left for the next run.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Housekeeping on the same schedule: anti-scraping counters older than two days.
  await pruneRateLimits(db).catch((e) => console.error("[cron] rate limit prune failed", e));
  const result = await runAlerts({ deadline: Date.now() + 240_000 });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
