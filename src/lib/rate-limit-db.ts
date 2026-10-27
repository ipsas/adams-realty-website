import { and, eq, lt, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window rate limits kept in Postgres (`rate_limits`), so every
 * serverless instance counts against the same numbers. One statement per
 * subject whatever the
 * number of windows: an upsert that bumps (or restarts) each window's counter
 * and returns the new counts.
 */

export type LimitWindow = {
  /** Distinguishes counters: include the window length, e.g. "page:1m". */
  name: string;
  limit: number;
  ms: number;
};

export type LimitResult = {
  ok: boolean;
  /** Seconds until the tightest exceeded window ends (0 when ok). */
  retryAfter: number;
  /** The window that was exceeded, if any. */
  exceeded: string | null;
};

/**
 * Counts one request by `subject` (a client address or IPv6 block, an account, a hashed email)
 * against every window. `units` is what this request costs (the page limiter
 * charges a full page load more than a client-side refresh); a window is
 * exceeded once its count passes its limit.
 */
export async function hitRateLimits(
  db: Executor,
  subject: string,
  windows: LimitWindow[],
  now: Date = new Date(),
  units: number = 1,
): Promise<LimitResult> {
  if (!windows.length) return { ok: true, retryAfter: 0, exceeded: null };
  const t = now.getTime();
  const rows = windows.map((w) => ({
    key: `${w.name}:${subject}`,
    windowStart: new Date(Math.floor(t / w.ms) * w.ms),
    count: units,
  }));
  const counts = await db
    .insert(rateLimits)
    .values(rows)
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} = excluded.window_start
          then ${rateLimits.count} + excluded.count else excluded.count end`,
        windowStart: sql`excluded.window_start`,
      },
    })
    .returning({ key: rateLimits.key, count: rateLimits.count });
  const byKey = new Map(counts.map((c) => [c.key, c.count]));

  let exceeded: LimitWindow | null = null;
  let retryAfter = 0;
  windows.forEach((w, i) => {
    const count = byKey.get(rows[i].key) ?? 0;
    if (count <= w.limit) return;
    const wait = Math.ceil((rows[i].windowStart.getTime() + w.ms - t) / 1000);
    if (wait > retryAfter) {
      retryAfter = wait;
      exceeded = w;
    }
  });
  return {
    ok: exceeded === null,
    retryAfter,
    exceeded: (exceeded as LimitWindow | null)?.name ?? null,
  };
}

/**
 * Gives back `units` that `hitRateLimits` counted at `now` (a reservation that
 * wasn't used). A window that has since restarted is left alone.
 */
export async function refundRateLimits(
  db: Executor,
  subject: string,
  windows: LimitWindow[],
  now: Date,
  units: number = 1,
): Promise<void> {
  const t = now.getTime();
  for (const w of windows) {
    await db
      .update(rateLimits)
      .set({ count: sql`greatest(${rateLimits.count} - ${units}, 0)` })
      .where(
        and(
          eq(rateLimits.key, `${w.name}:${subject}`),
          eq(rateLimits.windowStart, new Date(Math.floor(t / w.ms) * w.ms)),
        ),
      );
  }
}

/** Deletes counters whose window started more than `maxAgeMs` ago (the longest window is a day). */
export async function pruneRateLimits(
  db: Executor,
  now: Date = new Date(),
  maxAgeMs: number = 2 * 86_400_000,
): Promise<number> {
  const gone = await db
    .delete(rateLimits)
    .where(lt(rateLimits.windowStart, new Date(now.getTime() - maxAgeMs)))
    .returning({ key: rateLimits.key });
  return gone.length;
}
