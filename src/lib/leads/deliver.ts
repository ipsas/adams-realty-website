import { after } from "next/server";
import { describeError } from "@/lib/mls/write-errors";

/**
 * Runs `task` (sending lead emails) after the response has gone to the
 * visitor, with Next's `after()`. On Vercel that registers the work with
 * `waitUntil`, so the serverless function keeps running until every email is
 * sent instead of being frozen mid-send once the response is out; the visitor
 * doesn't wait for the mail provider either. Failures are logged: the lead is
 * already saved.
 *
 * Only for server actions and route handlers (see
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md).
 */
export function afterResponse(label: string, task: () => Promise<unknown>): void {
  after(async () => {
    try {
      await task();
    } catch (e) {
      console.error(`[${label}] failed after the response: ${describeError(e)}`);
    }
  });
}
