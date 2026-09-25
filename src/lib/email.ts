import { env } from "@/lib/env";

export type Email = {
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

/**
 * Sends transactional email through Resend's HTTP API. With no API key
 * configured (local dev), the plain-text version is printed to the server console.
 */
export async function sendEmail(email: Email): Promise<void> {
  if (!env.RESEND_API_KEY) {
    const unsubscribe = email.headers?.["List-Unsubscribe"];
    console.info(
      [
        `\n[email] To: ${[email.to].flat().join(", ")}`,
        `[email] Subject: ${email.subject}`,
        unsubscribe ? `[email] List-Unsubscribe: ${unsubscribe}` : null,
        `${email.text}\n`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
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
      reply_to: email.replyTo,
      headers: email.headers,
    }),
  });
  if (!res.ok) {
    throw new Error(`Email send failed (${res.status}): ${await res.text()}`);
  }
}
