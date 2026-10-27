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

export type SendResult =
  { ok: true } | { ok: false; reason: "email_not_configured" | "send_failed" };

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
 * The one log line per send attempt: the template, the recipient domains and
 * the outcome. Never the address, subject, body, links or Resend's reply.
 */
function logSend(email: Email, status: "sent" | "failed" | "not_configured", httpStatus?: number) {
  const line =
    `[email] kind=${email.kind} to_domain=${recipientDomains(email.to)} status=${status}` +
    (httpStatus ? ` http_status=${httpStatus}` : "");
  if (status === "sent") console.info(line);
  else if (status === "failed") console.error(line);
  else console.warn(line);
}

let warnedNotConfigured = false;

/**
 * Sends transactional email through Resend's HTTP API. Never throws: the
 * result says whether it went. With no API key, nothing is sent anywhere
 * (production, previews and dev alike) and the result is
 * `email_not_configured`, so callers don't mark the email as sent.
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
    });
  } catch {
    logSend(email, "failed");
    return { ok: false, reason: "send_failed" };
  }
  if (!res.ok) {
    logSend(email, "failed", res.status);
    return { ok: false, reason: "send_failed" };
  }
  logSend(email, "sent");
  return { ok: true };
}
