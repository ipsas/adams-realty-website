import { createHash } from "node:crypto";
import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import { emailOutbox } from "@/db/schema";
import type { Email, SendEmail, SendResult } from "@/lib/email";
import { describeError } from "@/lib/mls/write-errors";

/**
 * The durable retry for lead and assignment notices (`email_outbox`). When a
 * notice still fails after `sendTransactional`'s in-request tries, `enqueue`
 * stores a reference to it (kind, lead id, recipient role and id), never its
 * content. The sync cron (every 15 minutes) runs `processEmailOutbox`: it
 * claims a few due rows, rebuilds each email from the database as it is now,
 * and sends it once. A sent notice's row is deleted; a failed one is tried
 * again after 15 min × 2^(attempts − 1), and after OUTBOX_MAX_ATTEMPTS tries
 * in all it is marked dead with one log line. A notice whose lead or recipient
 * is gone is deleted.
 */

export type OutboxRow = typeof emailOutbox.$inferSelect;
export type OutboxItem = Pick<OutboxRow, "kind" | "entityId" | "recipientRole" | "recipientId">;

/** Tries in all (the in-request one first) before a notice is marked dead. */
export const OUTBOX_MAX_ATTEMPTS = 6;
/** Rows one cron run sends, at most. */
export const OUTBOX_RUN_LIMIT = 10;
/** The wait after the first try; doubled after each further one. */
const BACKOFF = sql`interval '15 minutes'`;
/** A claimed row is due again after this, should its run die before settling it. */
const LEASE = sql`interval '10 minutes'`;
/** No new row is started with less than this before the deadline: a row can take a send timeout and a few queries. */
export const OUTBOX_MIN_TIME_MS = 60_000;

/**
 * A failed send's reason for `last_status`: 'http_<code>', 'timeout' when
 * Resend didn't answer in time, or 'network' when the request failed.
 */
export function outboxStatus(res: SendResult | null): string {
  if (!res) return "error";
  if (res.ok) return "sent";
  if (res.reason === "email_not_configured") return "not_configured";
  if (res.timedOut) return "timeout";
  return res.status ? `http_${res.status}` : "network";
}

/**
 * Queues a notice whose send failed (it counts as the first try, so the next
 * comes 15 minutes on). Nothing when the same notice for the same recipient is
 * already queued. Never throws: a failure is logged and the notice is lost, as
 * it was before the outbox.
 */
export async function enqueueEmail(
  db: Executor,
  item: OutboxItem & { lastStatus: string },
): Promise<void> {
  try {
    await db
      .insert(emailOutbox)
      .values({
        kind: item.kind,
        entityId: item.entityId,
        recipientRole: item.recipientRole,
        recipientId: item.recipientId,
        lastStatus: item.lastStatus,
        attempts: 1,
        nextAttemptAt: sql`now() + ${BACKOFF}`,
      })
      .onConflictDoNothing();
    console.warn(
      `[email-outbox] kind=${item.kind} entity=${item.entityId} status=queued last=${item.lastStatus}`,
    );
  } catch (e) {
    console.error(
      `[email-outbox] kind=${item.kind} entity=${item.entityId} status=queue_failed: ${describeError(e)}`,
    );
  }
}

/**
 * Claims up to `limit` due rows for this run: their next_attempt_at moves a
 * LEASE ahead, so a concurrent run (SKIP LOCKED) or the next one won't take
 * them while this run sends.
 */
export async function claimDueEmails(db: Executor, limit: number): Promise<OutboxRow[]> {
  const due = db
    .select({ id: emailOutbox.id })
    .from(emailOutbox)
    .where(and(eq(emailOutbox.state, "pending"), lte(emailOutbox.nextAttemptAt, sql`now()`)))
    .orderBy(asc(emailOutbox.nextAttemptAt))
    .limit(limit)
    .for("update", { skipLocked: true });
  return db
    .update(emailOutbox)
    .set({ nextAttemptAt: sql`now() + ${LEASE}`, updatedAt: sql`now()` })
    .where(inArray(emailOutbox.id, due))
    .returning();
}

/** Hands back claimed rows this run didn't try: due now, their attempts unchanged. */
export async function releaseClaims(db: Executor, ids: OutboxRow["id"][]): Promise<void> {
  if (ids.length === 0) return;
  await db
    .update(emailOutbox)
    .set({ nextAttemptAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(inArray(emailOutbox.id, ids), eq(emailOutbox.state, "pending")));
}

/** Records a failed try: due again after the backoff, or dead after OUTBOX_MAX_ATTEMPTS. */
export async function recordFailure(
  db: Executor,
  row: OutboxRow,
  lastStatus: string,
): Promise<{ attempts: number; state: OutboxRow["state"] }> {
  const [r] = await db
    .update(emailOutbox)
    .set({
      attempts: sql`${emailOutbox.attempts} + 1`,
      lastStatus,
      state: sql`case when ${emailOutbox.attempts} + 1 >= ${OUTBOX_MAX_ATTEMPTS}::integer then 'dead' else 'pending' end`,
      nextAttemptAt: sql`now() + ${BACKOFF} * power(2, ${emailOutbox.attempts})`,
      updatedAt: sql`now()`,
    })
    .where(eq(emailOutbox.id, row.id))
    .returning({ attempts: emailOutbox.attempts, state: emailOutbox.state });
  return r ?? { attempts: row.attempts, state: row.state };
}

/**
 * The Resend idempotency key for an outbox try: the row and a hash of the
 * rebuilt body. Resend keeps a key 24 h and answers 409 when it comes back with
 * another body, so a rebuilt notice that changed (lead edited, another inbox)
 * gets a new key, while a resend of the same body can't be delivered twice.
 * The in-request try's key differs, so a lost reply after Resend accepted it
 * can mean one duplicate notice: a duplicate beats a lost lead.
 */
export function outboxIdempotencyKey(rowId: OutboxRow["id"], email: Email): string {
  const body = JSON.stringify([email.to, email.subject, email.text, email.html ?? null]);
  return `outbox/${rowId}/${createHash("sha256").update(body).digest("hex").slice(0, 16)}`;
}

export type OutboxDeps = {
  db?: Executor;
  /** One try per row: the default is `sendEmail`, not the retrying `sendTransactional`. */
  send: SendEmail;
  /** The email as it would be sent now; null when its lead or recipient is gone. */
  rebuild: (row: OutboxRow) => Promise<Email | null>;
  limit?: number;
  /** Epoch ms the run must be done by (the cron's budget); no limit when absent. */
  deadline?: number;
};

export type OutboxRun = { sent: number; retry: number; dead: number; gone: number };

/**
 * Sends the due notices once each (see the top of this file). Starts no row
 * with less than OUTBOX_MIN_TIME_MS before the deadline, and stops early on a
 * 429: the rows it claimed but didn't try are handed back (`releaseClaims`),
 * due again with no attempt spent. A row that fails to rebuild or settle is
 * logged and left to its lease.
 */
export async function processEmailOutbox(deps: OutboxDeps): Promise<OutboxRun> {
  const db = deps.db ?? defaultDb;
  const run: OutboxRun = { sent: 0, retry: 0, dead: 0, gone: 0 };
  const timeLeft = () =>
    deps.deadline === undefined || deps.deadline - Date.now() >= OUTBOX_MIN_TIME_MS;
  if (!timeLeft()) return run;
  const rows = await claimDueEmails(db, deps.limit ?? OUTBOX_RUN_LIMIT);
  for (const [i, row] of rows.entries()) {
    if (!timeLeft()) {
      await releaseUntried(db, rows.slice(i));
      break;
    }
    const tag = `[email-outbox] kind=${row.kind} id=${row.id}`;
    try {
      const email = await deps.rebuild(row);
      if (!email) {
        await db.delete(emailOutbox).where(eq(emailOutbox.id, row.id));
        console.warn(`${tag} status=gone`);
        run.gone++;
        continue;
      }
      let res: SendResult | null = null;
      try {
        res = await deps.send({ ...email, idempotencyKey: outboxIdempotencyKey(row.id, email) });
      } catch (e) {
        console.error(`${tag} send threw: ${describeError(e)}`);
      }
      if (res?.ok) {
        await db.delete(emailOutbox).where(eq(emailOutbox.id, row.id));
        console.info(`${tag} status=sent attempts=${row.attempts + 1}`);
        run.sent++;
        continue;
      }
      const last = outboxStatus(res);
      const { attempts, state } = await recordFailure(db, row, last);
      if (state === "dead") {
        console.error(`${tag} status=dead attempts=${attempts} last=${last}`);
        run.dead++;
      } else {
        console.warn(`${tag} status=retry attempts=${attempts} last=${last}`);
        run.retry++;
      }
      if (res && !res.ok && res.reason === "rate_limited") {
        await releaseUntried(db, rows.slice(i + 1));
        break;
      }
    } catch (e) {
      console.error(`${tag} failed: ${describeError(e)}`);
    }
  }
  return run;
}

/** `releaseClaims`, logged and left to the lease should it fail. */
async function releaseUntried(db: Executor, rows: OutboxRow[]): Promise<void> {
  await releaseClaims(
    db,
    rows.map((r) => r.id),
  ).catch((e) => console.error(`[email-outbox] release failed: ${describeError(e)}`));
}
