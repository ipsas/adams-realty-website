import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { runAlerts } from "@/lib/alerts/run";
import { isCronAuthorized } from "@/lib/cron-auth";
import { emailConfigured } from "@/lib/email";
import { activateEmailAlerts, createBatchBudget } from "@/lib/email-batch";
import { runLeadDigests } from "@/lib/leads/digest";
import { describeError } from "@/lib/mls/write-errors";
import { pruneRateLimits } from "@/lib/rate-limit-db";

export const maxDuration = 300;

/**
 * Saved-search and saved-home email alerts. Vercel Cron calls this hourly
 * with `Authorization: Bearer $CRON_SECRET` (see vercel.json); frequencies
 * (instant/daily/weekly) are decided per search in src/lib/alerts/schedule.ts.
 * Safe to call more often or re-run — nothing is sent twice. Work not started
 * within ~4 minutes is left for the next run.
 *
 * It also sends the staff's 7 a.m. morning summary (src/lib/leads/digest.ts)
 * if a sync run didn't already. Never twice a day; its outcome is reported but doesn't change the status.
 * `email.configured` says whether RESEND_API_KEY is set (false: nothing is being sent).
 * A 429 from Resend defers the rest (`rate_limited: true`) and is still a 200.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Housekeeping on the same schedule: anti-scraping counters older than two days.
  await pruneRateLimits(db).catch((e) =>
    console.error(`[cron] rate limit prune failed: ${describeError(e)}`),
  );
  // One batch-mail guard for the whole request: the per-run cap and a 429 stop cover both jobs.
  const budget = createBatchBudget({ db });
  const digests = await runLeadDigests({ deadline: Date.now() + 30_000, budget }).catch((e) => {
    console.error(`[cron] morning summary failed: ${describeError(e)}`);
    return { ok: false as const };
  });
  // The first run with email configured marks the backlog as seen, once (email-batch.ts).
  // If that fails, the alerts wait: without it they could mail weeks of changes at once.
  const configured = emailConfigured();
  if (configured) await activateEmailAlerts(db);
  const result = await runAlerts({ deadline: Date.now() + 240_000, budget });
  return NextResponse.json(
    { ...result, digests, email: { configured } },
    { status: result.ok ? 200 : 500 },
  );
}
