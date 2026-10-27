import { db as defaultDb, type Executor } from "@/db";
import type { SendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { hitRateLimits, refundRateLimits, type LimitWindow } from "@/lib/rate-limit-db";

/**
 * The send guard for batch mail: search alerts, saved-home digests and the
 * staff's morning summary. Transactional mail (password resets, lead notices,
 * lead copies, assignment notices, sync alerts) never goes through it, so it
 * is never blocked or counted here.
 *
 * Resend's free plan allows 100 emails a day for everything. Batch mail gets:
 *
 * - a per-run cap (EMAIL_BATCH_RUN_CAP, default 50), shared by everything one
 *   cron request sends, so a large backlog spreads over several runs;
 * - a daily budget (EMAIL_BATCH_DAILY_BUDGET, default 60) counted in Postgres
 *   (`rate_limits`, key `email-batch:1d:resend`) so every serverless instance
 *   shares it. Days are UTC days, like Resend's quota; the rest of the quota
 *   stays free for transactional mail;
 * - a stop: once Resend answers 429, nothing more is sent this run.
 *
 * Each item reserves its send *before* it is claimed (`reserve`): a refusal
 * means stop, and the item and all after it stay unclaimed and due, so
 * `last_alerted_at` / `last_notified_at` / `lead_digests` never advance for
 * them. The reservation is kept only if the email went; otherwise (claimed
 * by another run, nothing to say, a failed send) `release` refunds it.
 */

export type BatchSlot = {
  /** Sends through the guard: records whether this item's email went, and stops the batch on a 429. */
  send: SendEmail;
  /** Refunds the reservation unless the email went. Call once, when the item is done. */
  release: () => Promise<void>;
};

export type BatchBudget = {
  /**
   * One send's worth for the next item, sent with `send`; or null: stop, and
   * leave this item and the rest unclaimed and due.
   */
  reserve: (send: SendEmail) => Promise<BatchSlot | null>;
};

/** The shared daily count; the default lives in `rate_limits`. */
export type DailyCounter = {
  /** Counts one send; false (and nothing counted) when the day's budget is used up. */
  take: () => Promise<boolean>;
  refund: () => Promise<void>;
};

const DAY_MS = 86_400_000;
const SUBJECT = "resend";

export function dailyCounter(db: Executor, limit: number, now: Date): DailyCounter {
  const windows: LimitWindow[] = [{ name: "email-batch:1d", limit, ms: DAY_MS }];
  const refund = () => refundRateLimits(db, SUBJECT, windows, now);
  return {
    take: async () => {
      const hit = await hitRateLimits(db, SUBJECT, windows, now);
      if (!hit.ok) await refund();
      return hit.ok;
    },
    refund,
  };
}

export type BatchBudgetOptions = {
  db?: Executor;
  now?: Date;
  /** Default: EMAIL_BATCH_RUN_CAP. */
  runCap?: number;
  /** Default: EMAIL_BATCH_DAILY_BUDGET. */
  dailyLimit?: number;
  /** Default: `dailyCounter` on `rate_limits`. */
  daily?: DailyCounter;
};

/** One per cron request: building it touches nothing; the first `reserve` does. */
export function createBatchBudget(opts: BatchBudgetOptions = {}): BatchBudget {
  const runCap = opts.runCap ?? env.EMAIL_BATCH_RUN_CAP;
  const dailyLimit = opts.dailyLimit ?? env.EMAIL_BATCH_DAILY_BUDGET;
  const daily =
    opts.daily ?? dailyCounter(opts.db ?? defaultDb, dailyLimit, opts.now ?? new Date());
  let reserved = 0;
  let stopped: "run-cap" | "daily-budget" | "rate-limited" | null = null;
  const stop = (why: NonNullable<typeof stopped>, line: string) => {
    if (stopped) return;
    stopped = why;
    console.warn(`[email-batch] ${line}`);
  };

  return {
    reserve: async (send) => {
      if (stopped) return null;
      if (reserved >= runCap) {
        stop("run-cap", `per-run cap (${runCap}) reached; the rest waits for the next run`);
        return null;
      }
      if (!(await daily.take())) {
        stop(
          "daily-budget",
          `daily budget (${dailyLimit}) used up; the rest waits for tomorrow (UTC)`,
        );
        return null;
      }
      reserved++;
      let sent = false;
      let released = false;
      return {
        send: async (email) => {
          const result = await send(email);
          if (result.ok) sent = true;
          else if (result.reason === "rate_limited")
            stop("rate-limited", "rate limited by email provider; stopping batch sends this run");
          return result;
        },
        release: async () => {
          if (released) return;
          released = true;
          if (sent) return;
          reserved--;
          await daily.refund().catch(() => {});
        },
      };
    },
  };
}
