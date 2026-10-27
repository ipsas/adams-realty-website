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
 * - a budget, checked and charged under one lock (`reserve`): batch sends
 *   today below EMAIL_BATCH_DAILY_BUDGET (default 60, never more than
 *   BATCH_DAILY_LIMIT), all sends today below BATCH_DAILY_TOTAL_LIMIT and all
 *   sends this UTC month below BATCH_MONTHLY_TOTAL_LIMIT. So at least 30 sends
 *   a day (and 300 a month) always stay free for transactional mail;
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

/** Batch sends per UTC day, at most: EMAIL_BATCH_DAILY_BUDGET is clamped to it. */
export const BATCH_DAILY_LIMIT = 60;
/**
 * Batch mail may reserve only while all sends today (batch and transactional)
 * are below this: Resend's free quota is 100 a day, so 30 stay for transactional mail.
 */
export const BATCH_DAILY_TOTAL_LIMIT = 70;
/** Likewise for all sends this UTC month: Resend's free quota is 3,000. */
export const BATCH_MONTHLY_TOTAL_LIMIT = 2700;
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
   * Charges one batch send to today's row if `dailyBudget` (clamped to
   * BATCH_DAILY_LIMIT) and both totals allow it; returns the period charged,
   * or null (nothing charged).
   */
  reserve: (dailyBudget: number) => Promise<string | null>;
  /** Gives back one batch send on the period `reserve` returned (floored at 0). */
  refund: (period: string) => Promise<void>;
};

/** Today, 'YYYY-MM-DD' in UTC, by the database clock. */
const UTC_DAY = sql`to_char(now() at time zone 'UTC', 'YYYY-MM-DD')`;
/** All sends this UTC month on the days before today. */
const MONTH_BEFORE_TODAY = sql`(select coalesce(sum(m.total), 0) from email_send_counters m
  where left(m.period, 7) = to_char(now() at time zone 'UTC', 'YYYY-MM') and m.period <> ${UTC_DAY})`;

/** The `pg_advisory_xact_lock` key that serializes every `reserve`, across instances. */
export const SEND_COUNTER_LOCK = 4_658_129_017_334_201;

/**
 * Each reserve is a transaction: it takes SEND_COUNTER_LOCK, then upserts
 * today's row in a separate statement. Under READ COMMITTED that statement's
 * snapshot is taken after the lock was granted, so it sees every reserve
 * committed before it, and the batch, day and month limits hold exactly under
 * any concurrency. Today's own numbers come from the row the upsert locked
 * (its latest version), not from the snapshot, so a `countSent` committed in
 * between is seen too.
 *
 * `countSent` and `refund` don't take the lock. `countSent` only adds to
 * today's row, which reserve reads under its row lock, and it must never wait
 * to count mail that already went. `refund` only lowers counts: a reserve that
 * misses one refuses at worst one send early. What's left: a transactional
 * send counted on the old day while UTC midnight passes can be missed by the
 * month sum; the 300 sends between BATCH_MONTHLY_TOTAL_LIMIT and Resend's
 * 3,000 cover that.
 */
export function sendCounter(db: Executor): SendCounter {
  return {
    reserve: (dailyBudget) =>
      db.transaction(async (tx) => {
        const budget = Math.min(dailyBudget, BATCH_DAILY_LIMIT);
        await tx.execute(sql`select pg_advisory_xact_lock(${SEND_COUNTER_LOCK}::bigint)`);
        const res = await tx.execute<{ period: string }>(sql`
          insert into email_send_counters (period, batch, total)
          select ${UTC_DAY}, 1, 1
          where ${budget}::integer > 0
            and ${MONTH_BEFORE_TODAY} < ${BATCH_MONTHLY_TOTAL_LIMIT}
          on conflict (period) do update set
            batch = email_send_counters.batch + 1,
            total = email_send_counters.total + 1,
            updated_at = now()
          where email_send_counters.batch < ${budget}::integer
            and email_send_counters.total < ${BATCH_DAILY_TOTAL_LIMIT}
            and ${MONTH_BEFORE_TODAY} + email_send_counters.total < ${BATCH_MONTHLY_TOTAL_LIMIT}
          returning period`);
        return res.rows[0]?.period ?? null;
      }),
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

/**
 * Counts a transactional send against today's total: one per recipient (To,
 * CC and BCC alike, as Resend counts). Never blocked, and takes no lock.
 */
export async function countSent(recipients: number, db: Executor = defaultDb): Promise<void> {
  await db.execute(sql`
    insert into email_send_counters (period, total) values (${UTC_DAY}, ${recipients}::integer)
    on conflict (period) do update set
      total = email_send_counters.total + excluded.total,
      updated_at = now()`);
}

/** Counter rows are kept this long; the month limit only reads this month's. */
export const SEND_COUNTERS_KEEP_DAYS = 90;

/**
 * Deletes the counter rows of UTC days more than SEND_COUNTERS_KEEP_DAYS ago;
 * returns how many. `period` is compared as text ('YYYY-MM-DD' sorts like the
 * date), so no value in it can make the statement throw.
 */
export async function pruneSendCounters(db: Executor = defaultDb): Promise<number> {
  const res = await db.execute(sql`
    delete from email_send_counters
    where period < to_char((now() at time zone 'UTC') - ${SEND_COUNTERS_KEEP_DAYS}::integer * interval '1 day', 'YYYY-MM-DD')`);
  return res.rowCount ?? 0;
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
  /** Default: EMAIL_BATCH_DAILY_BUDGET. Clamped to BATCH_DAILY_LIMIT. */
  dailyLimit?: number;
  /** Default: `sendCounter` on `email_send_counters`. */
  counter?: SendCounter;
};

/** One per cron request: building it touches nothing; the first `reserve` does. */
export function createBatchBudget(opts: BatchBudgetOptions = {}): BatchBudget {
  const runCap = opts.runCap ?? env.EMAIL_BATCH_RUN_CAP;
  const dailyLimit = Math.min(opts.dailyLimit ?? env.EMAIL_BATCH_DAILY_BUDGET, BATCH_DAILY_LIMIT);
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
          `email budget used up (batch ${dailyLimit}/day, all ${BATCH_DAILY_TOTAL_LIMIT}/day, ` +
            `${BATCH_MONTHLY_TOTAL_LIMIT}/month, UTC); the rest waits`,
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
