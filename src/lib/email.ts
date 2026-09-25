import { env } from "@/lib/env";

export type Email = {
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

/**
 * Sends transactional email through Resend's HTTP API. With no API key
 * configured (local dev), the message is printed to the server console.
 */
export async function sendEmail(email: Email): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.info(
      `\n[email] To: ${[email.to].flat().join(", ")}\n[email] Subject: ${email.subject}\n${email.text}\n`,
    );
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [email.to].flat(),
      subject: email.subject,
      text: email.text,
      html: email.html,
      reply_to: email.replyTo,
    }),
  });
  if (!res.ok) {
    throw new Error(`Email send failed (${res.status}): ${await res.text()}`);
  }
}
