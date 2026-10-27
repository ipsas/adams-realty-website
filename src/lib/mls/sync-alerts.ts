import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { users } from "@/db/schema";
import { sendTransactional, type SendEmail } from "@/lib/email";
import type { SyncAlert } from "./sync-engine";
import { describeError, QUARANTINE_ESCALATE_AT_REFUSAL, redactPersonal } from "./write-errors";

/**
 * Ops emails about a stalled MLS sync: a page due for quarantine that was
 * refused (QuarantineRefusedError), and the refusal that was escalated
 * (QUARANTINE_ESCALATE_AT_REFUSAL). They go to every admin: there is no ops
 * recipient setting, and the lead email opt-outs (`lead_copies`,
 * `lead_digest`) are about leads, not the sync. No row values or listing keys:
 * the source, the cursor's timestamp, counts and the first error's class.
 */

export type AlertRecipient = { userId: string; email: string };

/** Every admin login. */
export async function adminRecipients(db: Executor): Promise<AlertRecipient[]> {
  return db
    .select({ userId: users.id, email: users.email })
    .from(users)
    .where(eq(users.role, "admin"));
}

const at = (alert: SyncAlert) => alert.at?.toISOString() ?? "the feed's start";

/** The email for one alert. */
export function syncAlertEmail(
  source: string,
  alert: SyncAlert,
): { subject: string; text: string } {
  const max = QUARANTINE_ESCALATE_AT_REFUSAL;
  const subject = alert.escalated
    ? `MLS sync ${source}: refused page quarantined and skipped after ${alert.refusal} refusals`
    : `MLS sync ${source}: page refused for quarantine (${alert.refusal} of ${max})`;
  const outcome = alert.escalated
    ? "Escalated: quarantined and advanced. The page was written without its rejected rows, " +
      "which are kept in sync_quarantine, and the sync moved on."
    : `Refusal ${alert.refusal} of ${max}: nothing of the page was written and the cursor stays. ` +
      (alert.refusal < max - 1
        ? `On refusal ${max} at this cursor, the page is quarantined anyway and the sync moves on.`
        : `On the next refusal at this cursor, the page is quarantined anyway and the sync moves on.`);
  const text = [
    `Source: ${source}`,
    `Sync mode: ${alert.mode}`,
    `Cursor: ${at(alert)}`,
    `Rejected: ${alert.rejected} of ${alert.total} rows on the page`,
    `First error: ${redactPersonal(alert.firstErrorClass)}`,
    "",
    outcome,
    "",
    "So many rejected rows usually means a schema or mapper problem, not bad records. " +
      "See the sync runs in the dashboard and the server log.",
  ].join("\n");
  return { subject, text };
}

/**
 * Same alert, same key: a retried run doesn't email twice (Resend drops a
 * repeat within 24 hours). The cursor's listing key is hashed, not sent.
 */
export function syncAlertKey(source: string, alert: SyncAlert, userId: string): string {
  const position = createHash("sha256")
    .update(`${alert.at?.toISOString() ?? "start"}/${alert.atKey ?? "-"}`)
    .digest("hex")
    .slice(0, 16);
  const step = alert.escalated ? "escalated" : `refusal-${alert.refusal}`;
  return `mls-quarantine:${source}:${position}:${step}:${userId}`;
}

/**
 * Emails `alert` to each of `recipients()`. Never throws: a failed lookup or
 * send is logged (redacted) and the others still go out. A send that reports
 * failure (no Resend key, an HTTP error) was already logged by sendEmail.
 * Each send is retried in the request (`sendTransactional`), never queued.
 */
export async function sendSyncAlert(
  source: string,
  alert: SyncAlert,
  deps: {
    recipients: () => Promise<AlertRecipient[]>;
    send?: SendEmail;
  },
): Promise<void> {
  const send = deps.send ?? sendTransactional;
  let recipients: AlertRecipient[];
  try {
    recipients = await deps.recipients();
  } catch (e) {
    console.error(`[mls] sync alert: looking up admins failed: ${describeError(e)}`);
    return;
  }
  if (!recipients.length) console.error(`[mls] sync alert for ${source}: no admin to email`);
  const { subject, text } = syncAlertEmail(source, alert);
  for (const r of recipients) {
    try {
      await send({
        kind: "sync-alert",
        to: r.email,
        subject,
        text,
        idempotencyKey: syncAlertKey(source, alert, r.userId),
      });
    } catch (e) {
      console.error(`[mls] sync alert email failed: ${describeError(e)}`);
    }
  }
}
