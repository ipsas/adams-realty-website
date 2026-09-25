import { NextResponse, type NextRequest } from "next/server";
import { isCronAuthorized } from "@/lib/cron-auth";
import { syncAllSources } from "@/lib/mls/sync";

export const maxDuration = 300;

/**
 * Scheduled MLS sync. Vercel Cron calls this with `Authorization: Bearer
 * $CRON_SECRET` (see vercel.json); any other scheduler can do the same.
 * `?purge=1` also removes listings that left the feed.
 */
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const purge = request.nextUrl.searchParams.get("purge") === "1";
  const results = await syncAllSources({ purge });
  const failed = results.some((r) => !r.ok);
  return NextResponse.json({ results }, { status: failed ? 500 : 200 });
}
