import { randomUUID } from "node:crypto";
import { BATCH_EMAIL_KINDS, countSent } from "@/lib/email-batch";
import { env } from "@/lib/env";

export type Email = {
  /** Which template this is, for the log line (the only thing logged besides the domain). */
  kind: EmailKind;
  to: string | string[];
  subject: string;
  /** Plain-text version. Always required: some people and spam filters read only this. */
  text: string;
  html?: string;
  replyTo?: string;
  /** Extra message headers, e.g. from `listUnsubscribeHeaders`. */
  headers?: Record<string, string>;
  /** Resend drops a repeat send with the same key within 24 hours, so a retried job can't double-send. */
  idempotencyKey?: string;
};

/**
 * RFC 2369 + RFC 8058 headers for bulk mail (alerts). Mail apps show their own
 * "Unsubscribe" button, which POSTs to `oneClickUrl` with no page visit;
 * Gmail and Yahoo require both headers from bulk senders.
 */
export function listUnsubscribeHeaders(oneClickUrl: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${oneClickUrl}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/** Shown in the server log for each email; never derived from the message's content. */
export type EmailKind =
  | "password-reset"
  | "lead-notice"
  | "lead-copy"
  | "lead-assignment"
  | "lead-digest"
  | "search-alert"
  | "saved-home-digest"
  | "sync-alert";

/**
 * `rate_limited`: Resend answered 429 (its send rate or daily quota), so batch
 * runs stop for the rest of the run. Every other failure is `send_failed`.
 * `status` is Resend's HTTP code (none when the request itself failed), and
 * `retryAfterMs` its Retry-After, when it sent one. `timedOut`: no answer
 * within SEND_TIMEOUT_MS (a failed request, so no status).
 */
export type SendResult =
  | { ok: true }
  | {
      ok: false;
      reason: "email_not_configured" | "send_failed" | "rate_limited";
      status?: number;
      retryAfterMs?: number;
      timedOut?: true;
    };

export type SendEmail = (email: Email) => Promise<SendResult>;

/** Whether email can be sent at all (RESEND_API_KEY is set). */
export function emailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

/** Recipient domains only: the local part of an address is personal. */
function recipientDomains(to: Email["to"]): string {
  const domains = [to].flat().map((addr) => {
    const at = addr.lastIndexOf("@");
    const domain =
      at < 0
        ? ""
        : addr
            .slice(at + 1)
            .replace(/[>\s].*$/, "")
            .toLowerCase();
    return /^[a-z0-9.-]+$/.test(domain) ? domain : "unknown";
  });
  return [...new Set(domains)].join(",") || "unknown";
}

/**
 * The one log line per send attempt: the template, the recipient domains, the
 * outcome and, for an HTTP error, its status code. Never the address, subject,
 * body, links or Resend's reply.
 */
function logSend(
  email: Email,
  status: "sent" | "failed" | "timeout" | "not_configured",
  http?: number,
) {
  const line =
    `[email] kind=${email.kind} to_domain=${recipientDomains(email.to)} status=${status}` +
    (http ? ` http=${http}` : "");
  if (status === "sent") console.info(line);
  else if (status === "not_configured") console.warn(line);
  else console.error(line);
}

/**
 * How long one Resend request may take before it's abandoned: a hung request
 * would otherwise hold a password reset, a dashboard action or the cron.
 */
export const SEND_TIMEOUT_MS = 8000;

let warnedNotConfigured = false;

/**
 * Sends transactional email through Resend's HTTP API. Never throws: the
 * result says whether it went. With no API key, nothing is sent anywhere
 * (production, previews and dev alike) and the result is
 * `email_not_configured`, so callers don't mark the email as sent. A request
 * with no answer after SEND_TIMEOUT_MS is aborted and fails (`timedOut`).
 */
export async function sendEmail(email: Email): Promise<SendResult> {
  if (!env.RESEND_API_KEY) {
    if (!warnedNotConfigured) {
      warnedNotConfigured = true;
      console.warn("email not configured: RESEND_API_KEY missing");
    }
    logSend(email, "not_configured");
    return { ok: false, reason: "email_not_configured" };
  }
  let res: Response;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), SEND_TIMEOUT_MS);
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        ...(email.idempotencyKey ? { "Idempotency-Key": email.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email.to].flat(),
        subject: email.subject,
        text: email.text,
        html: email.html,
        reply_to: email.replyTo ?? env.EMAIL_REPLY_TO,
        headers: email.headers,
      }),
      signal: abort.signal,
    });
  } catch {
    if (abort.signal.aborted) {
      logSend(email, "timeout");
      return { ok: false, reason: "send_failed", timedOut: true };
    }
    logSend(email, "failed");
    return { ok: false, reason: "send_failed" };
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    logSend(email, "failed", res.status);
    const retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), Date.now());
    return {
      ok: false,
      reason: res.status === 429 ? "rate_limited" : "send_failed",
      status: res.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    };
  }
  logSend(email, "sent");
  // Batch mail was counted when the guard reserved it. Counting is best effort:
  // the email already went, so a failure here is logged and never fails the send.
  // `to` is every recipient: an Email has no CC or BCC.
  if (!BATCH_EMAIL_KINDS.has(email.kind)) {
    await countSent([email.to].flat().length).catch(() =>
      console.error(`[email-batch] could not count a sent email (kind=${email.kind})`),
    );
  }
  return { ok: true };
}

/** A Retry-After header (seconds, or an HTTP date) in ms from `now`; undefined when absent or unreadable. */
export function parseRetryAfter(value: string | null, now: number): number | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

/** Tries per transactional send, the first included. */
export const RETRY_ATTEMPTS = 3;
/** All the waiting between tries, at most: someone (or the cron) is waiting. */
export const RETRY_WAIT_CAP_MS = 3000;
/** The wait after the first failed try when Resend sends no Retry-After; doubled after each. */
const RETRY_BASE_MS = 250;

/** A 429, a 5xx or no answer at all (the request failed or timed out) is worth another try; other 4xx never are. */
function retryable(res: SendResult): boolean {
  if (res.ok || res.reason === "email_not_configured") return false;
  return res.reason === "rate_limited" || res.status === undefined || res.status >= 500;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * `sendEmail` for transactional mail (password resets, lead notices and
 * copies, assignment notices, sync alerts), retried in the request on a 429,
 * a 5xx or a failed or timed-out request: up to RETRY_ATTEMPTS tries, waiting Resend's
 * Retry-After or else 250 ms, then 500 ms, and never more than
 * RETRY_WAIT_CAP_MS in all (a longer Retry-After ends it, and the failure is
 * returned). A wrapper rather than part of `sendEmail`, so the batch runs and
 * the outbox (src/lib/email-outbox.ts), which defer on their own, still try
 * once; batch kinds passed here are sent once too. Each try logs its own line;
 * a send that goes is counted once (by the `sendEmail` that sent it).
 * So the caller waits at most RETRY_ATTEMPTS × SEND_TIMEOUT_MS plus
 * RETRY_WAIT_CAP_MS (about 27 s) for a send.
 *
 * Every try carries the same idempotency key (a random one if the email has
 * none), so a try whose reply was lost can't make the next one send twice.
 */
export async function sendTransactional(
  email: Email,
  opts: { sleep?: (ms: number) => Promise<void> } = {},
): Promise<SendResult> {
  if (BATCH_EMAIL_KINDS.has(email.kind)) return sendEmail(email);
  const sleep = opts.sleep ?? wait;
  const keyed = email.idempotencyKey ? email : { ...email, idempotencyKey: randomUUID() };
  let waited = 0;
  for (let attempt = 1; ; attempt++) {
    const res = await sendEmail(keyed);
    if (res.ok || attempt >= RETRY_ATTEMPTS || !retryable(res)) return res;
    const delay = res.retryAfterMs ?? RETRY_BASE_MS * 2 ** (attempt - 1);
    if (waited + delay > RETRY_WAIT_CAP_MS) return res;
    waited += delay;
    await sleep(delay);
  }
}
