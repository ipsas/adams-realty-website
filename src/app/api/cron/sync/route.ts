import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { syncAllSources } from "@/lib/mls/sync";

export const maxDuration = 300;

function authorized(request: NextRequest): boolean {
  if (!env.CRON_SECRET) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Scheduled MLS sync. Vercel Cron calls this with `Authorization: Bearer
 * $CRON_SECRET` (see vercel.json); any other scheduler can do the same.
 * `?purge=1` also removes listings that left the feed.
 */
export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const purge = request.nextUrl.searchParams.get("purge") === "1";
  const results = await syncAllSources({ purge });
  const failed = results.some((r) => !r.ok);
  return NextResponse.json({ results }, { status: failed ? 500 : 200 });
}
