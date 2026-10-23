import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { runLeadDigests } from "@/lib/leads/digest";
import { LISTINGS_TAG } from "@/lib/listings/cache-tags";
import { syncAllSources } from "@/lib/mls/sync";

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
 * Its outcome doesn't change the status.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const started = Date.now();
  const params = request.nextUrl.searchParams;
  const results = await syncAllSources({
    mode: params.get("purge") === "1" ? "purge" : "incremental",
    allowLargePurge: params.get("allowLargePurge") === "1",
    deadline: Date.now() + BUDGET_MS,
  });
  if (results.some((r) => (r.ok ? r.result.changed : r.changed))) {
    revalidateTag(LISTINGS_TAG, "max");
  }
  const digests = await runLeadDigests({ deadline: started + (maxDuration - 15) * 1000 }).catch(
    (e) => {
      console.error("[cron] morning summary failed", e);
      return { ok: false as const };
    },
  );
  const failed = results.some((r) => !r.ok);
  return NextResponse.json({ results, digests }, { status: failed ? 500 : 200 });
}
