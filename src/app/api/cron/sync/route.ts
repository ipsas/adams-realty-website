import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
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
 * After any change, the cached listing data (home page stats, area guides…)
 * is revalidated. 200 when every source succeeded or stopped partway; 500 if
 * any failed.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = request.nextUrl.searchParams;
  const results = await syncAllSources({
    mode: params.get("purge") === "1" ? "purge" : "incremental",
    allowLargePurge: params.get("allowLargePurge") === "1",
    deadline: Date.now() + BUDGET_MS,
  });
  if (results.some((r) => r.ok && r.result.changed)) revalidateTag(LISTINGS_TAG, "max");
  const failed = results.some((r) => !r.ok);
  return NextResponse.json({ results }, { status: failed ? 500 : 200 });
}
