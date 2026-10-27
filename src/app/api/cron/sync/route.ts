import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { isCronAuthorized } from "@/lib/cron-auth";
import { emailConfigured } from "@/lib/email";
import { pruneSendCounters } from "@/lib/email-batch";
import { runLeadDigests } from "@/lib/leads/digest";
import { retryLeadEmails } from "@/lib/leads/outbox";
import { LISTINGS_TAG } from "@/lib/listings/cache-tags";
import { syncAllSources } from "@/lib/mls/sync";
import { backfillKeywordTsv } from "@/lib/search/keyword-backfill";
import { describeError } from "@/lib/mls/write-errors";

export const maxDuration = 300;

/** Leaves 45 s of the function's limit for the last page, bookkeeping and the response. */
const BUDGET_MS = (maxDuration - 45) * 1000;

/**
 * Scheduled MLS sync. Vercel Cron calls this with `Authorization: Bearer
 * $CRON_SECRET` (see vercel.json); any other scheduler can do the same.
 *
 * - Default: an incremental sync. It stops between pages before the time
 *   budget runs out and ends `partial`; the next call carries on from the
 *   saved cursor.
 * - `?purge=1`: only the purge (listings that left the feed), no incremental.
 *   It aborts if it would remove more than 5% of the listings; add
 *   `&allowLargePurge=1` once you've checked the feed really dropped them.
 *   It also prunes old email send counters (best effort, not in the status).
 *
 * After any change (even by a run that then failed), the cached listing data
 * (home page stats, area guides…) is revalidated. 200 when every source
 * succeeded, stopped partway, or skipped an incremental sync because another
 * run was still going (recorded in sync_runs); 500 if any failed. A purge
 * that can't start because a sync holds the source waits for it, and fails
 * (500, recorded) if it still can't: it must never go missing quietly.
 *
 * Every run (every 15 minutes on Vercel Pro) also tries the staff's 7 a.m.
 * morning summary (src/lib/leads/digest.ts), so it goes out by about 7:15
 * Eastern: before 7 a.m. it does nothing, and it never sends twice a day.
 * Before it, lead and assignment notices whose send failed are retried from
 * `email_outbox` (src/lib/email-outbox.ts; a few per run within the sync's
 * budget, best effort).
 * Neither outcome changes the status. Then listings with no `keyword_tsv`
 * get one (`backfillKeywordTsv`, batch after batch in the time left; best
 * effort, not in the status, logged when it filled any). `email.configured` says whether
 * RESEND_API_KEY is set (false: nothing is being sent).
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const params = request.nextUrl.searchParams;
  const purge = params.get("purge") === "1";
  if (purge) {
    // Daily housekeeping: email_send_counters rows older than 90 days (email-batch.ts).
    await pruneSendCounters().catch((e) =>
      console.error(`[cron] email counter prune failed: ${describeError(e)}`),
    );
  }
  const results = await syncAllSources({
    mode: purge ? "purge" : "incremental",
    allowLargePurge: params.get("allowLargePurge") === "1",
    deadline: Date.now() + BUDGET_MS,
  });
  if (results.some((r) => (r.ok ? r.result.changed : r.changed))) {
    revalidateTag(LISTINGS_TAG, "max");
  }
  if (emailConfigured()) {
    await retryLeadEmails({ deadline: started + BUDGET_MS }).catch((e) =>
      console.error(`[cron] email outbox failed: ${describeError(e)}`),
    );
  }
  const digests = await runLeadDigests({ deadline: started + (maxDuration - 15) * 1000 }).catch(
    (e) => {
      console.error(`[cron] morning summary failed: ${describeError(e)}`);
      return { ok: false as const };
    },
  );
  // Last, so it only uses time left over within the sync's budget.
  await backfillKeywordTsv(db, { deadline: started + BUDGET_MS }).then(
    (filled) => {
      if (filled > 0) console.info(`[cron] keyword search: filled ${filled} listings`);
    },
    (e) => console.error(`[cron] keyword backfill failed: ${describeError(e)}`),
  );
  const failed = results.some((r) => !r.ok);
  return NextResponse.json(
    { results, digests, email: { configured: emailConfigured() } },
    { status: failed ? 500 : 200 },
  );
}
