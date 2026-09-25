import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Scheduled jobs under /api/cron/* are called by Vercel Cron (or any
 * scheduler) with `Authorization: Bearer $CRON_SECRET`. Constant-time
 * comparison; always false when no secret is configured, so the routes are
 * closed by default.
 */
export function isCronAuthorized(request: Request, secret = env.CRON_SECRET): boolean {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
