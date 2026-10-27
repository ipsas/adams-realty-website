import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db as defaultDb, type Executor } from "@/db";
import { emailOutbox } from "@/db/schema";
import type { Email, SendEmail, SendResult } from "@/lib/email";
import { describeError } from "@/lib/mls/write-errors";

/**
 * The durable retry for lead and assignment notices (`email_outbox`). When a
 * notice still fails after `sendTransactional`'s in-request tries, `enqueue`
 * stores a reference to it (kind, lead id, recipient role and id). The sync
 * cron (every 15 minutes) runs `processEmailOutbox`: it claims a few due rows
 * and rebuilds each email from the database as it is now. The first outbox try
 * stores that email (`payload`) and the time (`first_tried_at`) before sending
 * it; later tries still rebuild, only to check the lead and recipient, and
 * send the stored payload, so the row's key always carries the same request.
 * The content is stored only while the row is pending: a sent row is deleted,
 * and a dead one's payload cleared. A failed notice is tried again after
 * 15 min × 2^(attempts − 1), and after OUTBOX_MAX_ATTEMPTS tries in all
 * (a 409 for a same-key request still in progress counts as one) it is marked
 * dead with one log line. A notice whose lead or recipient is gone is deleted.
 * A row whose key may have expired, or a 409 for a key already used with
 * another payload, is marked dead unsent (see `outboxIdempotencyKey`), as is a
 * row of a kind this code doesn't know.
 */

export type OutboxRow = typeof emailOutbox.$inferSelect;
export type OutboxItem = Pick<OutboxRow, "kind" | "entityId" | "recipientRole" | "recipientId">;

/** Every kind the outbox sends: a Record, so a kind added to the column must be added here. */
const OUTBOX_KINDS: Record<OutboxRow["kind"], true> = {
  "lead-notice": true,
  "lead-copy": true,
  "lead-assignment": true,
};

/** False for a row written with a kind this code doesn't know (the column is plain text). */
export function isOutboxKind(kind: string): kind is OutboxRow["kind"] {
  return Object.hasOwn(OUTBOX_KINDS, kind);
}

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
/** A row's key is not used again this long after its first outbox try: Resend keeps a key 24 h. */
export const OUTBOX_KEY_TTL_MS = 23 * 60 * 60_000;

/**
 * A failed send's reason for `last_status`: 'http_<code>', '409_concurrent'
 * or '409_payload_changed' for Resend's idempotency 409s, 'timeout' when
 * Resend didn't answer in time, or 'network' when the request failed.
 */
export function outboxStatus(res: SendResult | null): string {
  if (!res) return "error";
  if (res.ok) return "sent";
  if (res.reason === "email_not_configured") return "not_configured";
  if (res.conflict === "concurrent_idempotent_requests") return "409_concurrent";
  if (res.conflict === "invalid_idempotent_request") return "409_payload_changed";
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

/**
 * Records a failed try: due again after the backoff, or dead (its payload
 * cleared) after OUTBOX_MAX_ATTEMPTS, or now when `dead`.
 */
export async function recordFailure(
  db: Executor,
  row: OutboxRow,
  lastStatus: string,
  dead = false,
): Promise<{ attempts: number; state: OutboxRow["state"] }> {
  const ends = dead
    ? sql`true`
    : sql`${emailOutbox.attempts} + 1 >= ${OUTBOX_MAX_ATTEMPTS}::integer`;
  const [r] = await db
    .update(emailOutbox)
    .set({
      attempts: sql`${emailOutbox.attempts} + 1`,
      lastStatus,
      state: sql`case when ${ends} then 'dead' else 'pending' end`,
      payload: sql`case when ${ends} then null else ${emailOutbox.payload} end`,
      nextAttemptAt: sql`now() + ${BACKOFF} * power(2, ${emailOutbox.attempts})`,
      updatedAt: sql`now()`,
    })
    .where(eq(emailOutbox.id, row.id))
    .returning({ attempts: emailOutbox.attempts, state: emailOutbox.state });
  return r ?? { attempts: row.attempts, state: row.state };
}

/**
 * The Resend idempotency key for every outbox try of a row: one key per notice
 * row, so a try whose reply was lost after Resend accepted it can't make a
 * later try send the notice again. Every try sends the payload stored on the
 * first, so a lead edited since doesn't change the request. Resend keeps a key
 * 24 h; the outbox's tries are 15 + 30 + 60 + 120 + 240 min = 7 h 45 min after
 * the first, plus cron and lease slack, and a row whose first outbox try is
 * over OUTBOX_KEY_TTL_MS old (a long outage) is marked dead rather than risk a
 * duplicate. Should Resend still answer 409 `invalid_idempotent_request`, it
 * already holds another request for this row, so the row is marked dead rather
 * than sent again under another key. The in-request try's key differs, so a
 * lost reply there can still mean one duplicate notice: a duplicate beats a
 * lost lead.
 */
export function outboxIdempotencyKey(rowId: OutboxRow["id"]): string {
  return `outbox/${rowId}`;
}

/**
 * When the row's key was first used, for the OUTBOX_KEY_TTL_MS check: its
 * first_tried_at, or null before its first outbox try. Every outbox try now
 * stores first_tried_at before it sends, so a row tried already (attempts > 1)
 * without one was tried before migration 0025 under the same key: its
 * created_at stands in, the earliest that key can have been used.
 */
export function keyFirstUsedAt(
  row: Pick<OutboxRow, "firstTriedAt" | "attempts" | "createdAt">,
): Date | null {
  return row.firstTriedAt ?? (row.attempts > 1 ? row.createdAt : null);
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
      // Never rebuilt as some other notice: kept dead, for a look, until pruned.
      if (!isOutboxKind(row.kind)) {
        await markDead(db, row, "unknown_kind");
        console.error(`${tag} status=dead last=unknown_kind`);
        run.dead++;
        continue;
      }
      // Resend may have dropped the key: a send now could go twice.
      const keyUsedAt = keyFirstUsedAt(row);
      if (keyUsedAt && Date.now() - keyUsedAt.getTime() > OUTBOX_KEY_TTL_MS) {
        await markDead(db, row, "key_expired");
        console.error(`${tag} status=dead last=key_expired`);
        run.dead++;
        continue;
      }
      // Rebuilt on every try, to drop a notice whose lead or recipient is gone.
      const email = await deps.rebuild(row);
      if (!email) {
        await db.delete(emailOutbox).where(eq(emailOutbox.id, row.id));
        console.warn(`${tag} status=gone`);
        run.gone++;
        continue;
      }
      const key = outboxIdempotencyKey(row.id);
      let payload = row.payload;
      if (!payload) {
        // Stored before the send, so a try whose reply is lost leaves its request for the next.
        payload = { ...email, idempotencyKey: key };
        await db
          .update(emailOutbox)
          .set({
            payload,
            firstTriedAt: sql`coalesce(${emailOutbox.firstTriedAt}, case when ${emailOutbox.attempts} > 1 then ${emailOutbox.createdAt} else now() end)`,
            updatedAt: sql`now()`,
          })
          .where(eq(emailOutbox.id, row.id));
      }
      let res: SendResult | null = null;
      try {
        res = await deps.send({ ...payload, idempotencyKey: key });
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
      const conflict = res && !res.ok ? res.conflict : undefined;
      const { attempts, state } = await recordFailure(
        db,
        row,
        last,
        conflict === "invalid_idempotent_request",
      );
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

/** Dead rows are kept this long after their last try, for a look at why they failed. */
export const OUTBOX_DEAD_KEEP_DAYS = 30;

/**
 * Deletes the dead rows last tried more than OUTBOX_DEAD_KEEP_DAYS ago;
 * returns how many. Sent rows are already deleted when sent, and pending ones
 * are never pruned, however old.
 */
export async function pruneEmailOutbox(db: Executor = defaultDb): Promise<number> {
  const res = await db
    .delete(emailOutbox)
    .where(
      and(
        eq(emailOutbox.state, "dead"),
        lt(
          emailOutbox.updatedAt,
          sql`now() - ${OUTBOX_DEAD_KEEP_DAYS}::integer * interval '1 day'`,
        ),
      ),
    );
  return res.rowCount ?? 0;
}

/** Ends a row unsent, its payload cleared; attempts unchanged. */
async function markDead(db: Executor, row: OutboxRow, lastStatus: string): Promise<void> {
  await db
    .update(emailOutbox)
    .set({ state: "dead", lastStatus, payload: null, updatedAt: sql`now()` })
    .where(eq(emailOutbox.id, row.id));
}

/** `releaseClaims`, logged and left to the lease should it fail. */
async function releaseUntried(db: Executor, rows: OutboxRow[]): Promise<void> {
  await releaseClaims(
    db,
    rows.map((r) => r.id),
  ).catch((e) => console.error(`[email-outbox] release failed: ${describeError(e)}`));
}
