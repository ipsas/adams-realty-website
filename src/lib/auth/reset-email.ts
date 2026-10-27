import { sendEmail, type SendEmail } from "@/lib/email";
import { passwordResetEmail } from "@/lib/email-templates";

/**
 * Better Auth's `sendResetPassword`. Never throws, so the person asking gets
 * the same generic answer whether or not the email went; sendEmail logs one
 * redacted line, and the reset link (its token) is never logged.
 */
export async function sendPasswordReset(
  { user, url }: { user: { name: string; email: string }; url: string },
  send: SendEmail = sendEmail,
): Promise<void> {
  const email = passwordResetEmail({ name: user.name, url });
  await send({
    kind: "password-reset",
    to: user.email,
    subject: email.subject,
    text: email.text,
    html: email.html,
  }).catch(() => undefined);
}
