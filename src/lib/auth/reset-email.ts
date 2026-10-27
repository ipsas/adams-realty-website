import { sendTransactional, type SendEmail, type SendResult } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email-templates";

/**
 * Better Auth's `sendResetPassword`. Never throws, so the person asking gets
 * the same generic answer whether or not the email went. The send is retried
 * in the request (`sendTransactional`) and never stored: the link holds the
 * token. sendEmail logs one redacted line per try; a send that still fails
 * adds exactly one `[email] kind=reset status=failed http=<code|none>`. The
 * reset link (its token) is never logged.
 */
export async function sendPasswordReset(
  { user, url }: { user: { name: string; email: string }; url: string },
  send: SendEmail = sendTransactional,
): Promise<void> {
  const email = passwordResetEmail({ name: user.name, url });
  const res: SendResult | null = await send({
    kind: "password-reset",
    to: user.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  }).catch(() => null);
  if (res?.ok || res?.reason === "email_not_configured") return;
  console.error(`[email] kind=reset status=failed http=${res?.status ?? "none"}`);
}
