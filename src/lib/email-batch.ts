import { sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import type { SendEmail } from "@/lib/email";
import { env } from "@/lib/env";

/**
 * The send guard for batch mail: search alerts, saved-home digests and the
 * staff's morning summary. Transactional mail (password resets, lead notices,
 * lead copies, assignment notices, sync alerts) never goes through it and is
 * never blocked; `sendEmail` only counts it (`countSent`) once it went.
 *
 * Resend's free plan allows 100 emails a day and 3,000 a month for
 * everything. Every send is counted per UTC day (Resend's day) in the logged
 * table `email_send_counters`, keyed by the database clock so no instance's
 * own clock matters. Batch mail gets:
 *
 * - a per-run cap (EMAIL_BATCH_RUN_CAP, default 50), shared by everything one
 *   cron request sends, so a large backlog spreads over several runs;
 * - a budget, checked and charged in one atomic statement (`reserve`): batch
 *   sends today below EMAIL_BATCH_DAILY_BUDGET (default 60), all sends today
 *   below DAILY_TOTAL_CAP and all sends this UTC month below
 *   MONTHLY_TOTAL_CAP. The rest of the quota stays free for transactional mail;
 * - a stop: once Resend answers 429, nothing more is sent this run (a planned
 *   deferral, not a failure); after MAX_CONSECUTIVE_FAILURES other failures in
 *   a row, likewise.
 *
 * Each item reserves its send *before* it is claimed (`reserve`): a refusal
 * means stop, and the item and all after it stay unclaimed and due, so
 * `last_alerted_at` / `last_notified_at` / `lead_digests` never advance for
 * them. The reservation is kept only if the email went; otherwise (claimed
 * by another run, nothing to say, a failed send) `release` refunds it on the
 * day it was charged to. Only an item that never tried to send gives its
 * place under the per-run cap back.
 */

/** All sends (batch and transactional) per UTC day: Resend's free quota is 100. */
export const DAILY_TOTAL_CAP = 85;
/** All sends per UTC month: Resend's free quota is 3,000. */
export const MONTHLY_TOTAL_CAP = 2700;
/** Non-429 send failures in a row after which the batch stops for the run. */
export const MAX_CONSECUTIVE_FAILURES = 3;

/** Batch mail kinds: counted by `reserve`, so `sendEmail` doesn't count them again. */
export const BATCH_EMAIL_KINDS: ReadonlySet<string> = new Set([
  "search-alert",
  "saved-home-digest",
  "lead-digest",
]);

export type BatchSlot = {
  /** Sends through the guard: records whether this item's email went, and stops the batch on a 429. */
  send: SendEmail;
  /** True once this slot's send got a 429: the item is deferred, not failed. */
  readonly rateLimited: boolean;
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

/** The shared send counts; the default lives in `email_send_counters`. */
export type SendCounter = {
  /**
   * Charges one batch send to today's row if `dailyBudget` and both totals
   * allow it; returns the period charged, or null (nothing charged).
   */
  reserve: (dailyBudget: number) => Promise<string | null>;
  /** Gives back one batch send on the period `reserve` returned (floored at 0). */
  refund: (period: string) => Promise<void>;
};

/** Today, 'YYYY-MM-DD' in UTC, by the database clock. */
const UTC_DAY = sql`to_char(now() at time zone 'UTC', 'YYYY-MM-DD')`;
/** All sends this UTC month so far. */
const MONTH_TOTAL = sql`(select coalesce(sum(m.total), 0) from email_send_counters m
  where left(m.period, 7) = to_char(now() at time zone 'UTC', 'YYYY-MM'))`;

/**
 * One statement per reserve. The day row's conditions are checked under its
 * row lock, so concurrent runs can't overshoot the daily numbers. The month
 * sum reads the other days' rows without that lock, so two runs racing on the
 * last few sends of a month could both pass; the 300 sends of slack between
 * MONTHLY_TOTAL_CAP and Resend's 3,000 make that harmless.
 */
export function sendCounter(db: Executor): SendCounter {
  return {
    reserve: async (dailyBudget) => {
      const res = await db.execute<{ period: string }>(sql`
        insert into email_send_counters (period, batch, total)
        select ${UTC_DAY}, 1, 1
        where ${dailyBudget}::integer > 0 and ${MONTH_TOTAL} < ${MONTHLY_TOTAL_CAP}
        on conflict (period) do update set
          batch = email_send_counters.batch + 1,
          total = email_send_counters.total + 1,
          updated_at = now()
        where email_send_counters.batch < ${dailyBudget}::integer
          and email_send_counters.total < ${DAILY_TOTAL_CAP}
          and ${MONTH_TOTAL} < ${MONTHLY_TOTAL_CAP}
        returning period`);
      return res.rows[0]?.period ?? null;
    },
    refund: async (period) => {
      await db.execute(sql`
        update email_send_counters set
          batch = greatest(batch - 1, 0),
          total = greatest(total - 1, 0),
          updated_at = now()
        where period = ${period}`);
    },
  };
}

/** Counts a transactional send (one per recipient) against today's total. */
export async function countSent(recipients: number, db: Executor = defaultDb): Promise<void> {
  await db.execute(sql`
    insert into email_send_counters (period, total) values (${UTC_DAY}, ${recipients}::integer)
    on conflict (period) do update set
      total = email_send_counters.total + excluded.total,
      updated_at = now()`);
}

export const ALERTS_ACTIVATED_FLAG = "email_alerts_activated";

/**
 * Once, on the first alerts run with email configured: marks everything older
 * than 24 hours as already seen, so saved searches and saved homes from before
 * email worked don't all mail their backlog at once. After that each keeps its
 * own window (schedule.ts). One transaction; only the run that inserts the
 * marker updates anything, so concurrent runs can't apply it twice. True when
 * this call activated.
 */
export async function activateEmailAlerts(db: Executor = defaultDb): Promise<boolean> {
  const done = await db.execute(sql`select 1 from app_flags where key = ${ALERTS_ACTIVATED_FLAG}`);
  if (done.rows.length) return false;
  return db.transaction(async (tx) => {
    const won = await tx.execute(sql`
      insert into app_flags (key) values (${ALERTS_ACTIVATED_FLAG})
      on conflict (key) do nothing returning key`);
    if (!won.rows.length) return false;
    await tx.execute(sql`
      update saved_searches set last_alerted_at =
        greatest(coalesce(last_alerted_at, created_at), now() - interval '24 hours')`);
    await tx.execute(sql`
      update saved_listings set last_notified_at =
        greatest(coalesce(last_notified_at, created_at), now() - interval '24 hours')`);
    console.info("[email-batch] alerts activated: changes older than 24 hours marked as seen");
    return true;
  });
}

export type BatchBudgetOptions = {
  db?: Executor;
  /** Default: EMAIL_BATCH_RUN_CAP. */
  runCap?: number;
  /** Default: EMAIL_BATCH_DAILY_BUDGET. */
  dailyLimit?: number;
  /** Default: `sendCounter` on `email_send_counters`. */
  counter?: SendCounter;
};

/** One per cron request: building it touches nothing; the first `reserve` does. */
export function createBatchBudget(opts: BatchBudgetOptions = {}): BatchBudget {
  const runCap = opts.runCap ?? env.EMAIL_BATCH_RUN_CAP;
  const dailyLimit = opts.dailyLimit ?? env.EMAIL_BATCH_DAILY_BUDGET;
  const counter = opts.counter ?? sendCounter(opts.db ?? defaultDb);
  let reserved = 0;
  let failures = 0;
  let stopped: "run-cap" | "budget" | "rate-limited" | "failing" | null = null;
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
      const period = await counter.reserve(dailyLimit);
      if (!period) {
        stop(
          "budget",
          `email budget used up (batch ${dailyLimit}/day, all ${DAILY_TOTAL_CAP}/day, ` +
            `${MONTHLY_TOTAL_CAP}/month, UTC); the rest waits`,
        );
        return null;
      }
      reserved++;
      let tried = false;
      let sent = false;
      let rateLimited = false;
      let released = false;
      return {
        get rateLimited() {
          return rateLimited;
        },
        send: async (email) => {
          tried = true;
          const result = await send(email);
          if (result.ok) {
            sent = true;
            failures = 0;
          } else if (result.reason === "rate_limited") {
            rateLimited = true;
            stop("rate-limited", "rate limited by email provider; stopping batch sends this run");
          } else if (++failures >= MAX_CONSECUTIVE_FAILURES) {
            stop(
              "failing",
              `${MAX_CONSECUTIVE_FAILURES} sends failed in a row; stopping batch sends this run`,
            );
          }
          return result;
        },
        release: async () => {
          if (released) return;
          released = true;
          if (sent) return;
          // A failed send still used its place under the run cap; Resend didn't count it.
          if (!tried) reserved--;
          await counter.refund(period).catch(() => {});
        },
      };
    },
  };
}
