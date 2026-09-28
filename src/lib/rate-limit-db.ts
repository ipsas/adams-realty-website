import { lt, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { rateLimits } from "@/db/schema";

/**
 * Fixed-window rate limits kept in Postgres (`rate_limits`), so every
 * serverless instance counts against the same numbers, unlike the in-memory
 * `rateLimit` in ./rate-limit.ts. One statement per request whatever the
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

/** Counts one request by `subject` (a client IP) against every window. */
export async function hitRateLimits(
  db: Executor,
  subject: string,
  windows: LimitWindow[],
  now: Date = new Date(),
): Promise<LimitResult> {
  if (!windows.length) return { ok: true, retryAfter: 0, exceeded: null };
  const t = now.getTime();
  const rows = windows.map((w) => ({
    key: `${w.name}:${subject}`,
    windowStart: new Date(Math.floor(t / w.ms) * w.ms),
    count: 1,
  }));
  const counts = await db
    .insert(rateLimits)
    .values(rows)
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${rateLimits.windowStart} = excluded.window_start
          then ${rateLimits.count} + 1 else 1 end`,
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
