import type { Executor } from "@/db";
import { clientIp } from "@/lib/anti-scraping";
import { hitFormLimits, retryPhrase } from "@/lib/form-guard";
import { formSignals, MIN_FILL_MS, type SpamReason } from "@/lib/spam";

/**
 * Spam checks for email sign-up, run by a Better Auth `before` hook on
 * `/sign-up/email` (src/lib/auth/auth.ts), so they also cover robots that
 * post to the endpoint directly. The sign-up form sends its honeypot and
 * timer (src/lib/spam.ts) as headers, since Better Auth's body is its own.
 *
 * Unlike a lead, a suspect sign-up isn't stored: no account is created and
 * the person is asked to try again (a moment later, a real person passes).
 */

export const SIGN_UP_HONEYPOT_HEADER = "x-form-hp";
export const SIGN_UP_ELAPSED_HEADER = "x-form-elapsed";

export type SignUpVerdict =
  | { ok: true }
  | {
      ok: false;
      status: "TOO_MANY_REQUESTS" | "BAD_REQUEST";
      message: string;
      spam?: SpamReason[];
    };

export async function checkSignUp(
  db: Executor,
  headers: Headers,
  email: string | null,
  opts: { production?: boolean; now?: Date } = {},
): Promise<SignUpVerdict> {
  const limited = await hitFormLimits(db, "signup", { ip: clientIp(headers), email }, opts);
  if (!limited.ok) {
    return {
      ok: false,
      status: "TOO_MANY_REQUESTS",
      message: `Too many accounts were created from here recently. Please try again in ${retryPhrase(limited.retryAfter)}.`,
    };
  }
  const spam = formSignals({
    honeypot: headers.get(SIGN_UP_HONEYPOT_HEADER),
    elapsed: headers.get(SIGN_UP_ELAPSED_HEADER),
    minMs: MIN_FILL_MS.signUp,
  });
  if (spam.length) {
    console.warn(`[sign-up] refused as suspected spam (${spam.join(", ")})`);
    return {
      ok: false,
      status: "BAD_REQUEST",
      message: "We couldn't create your account just now. Please check your details and try again.",
      spam,
    };
  }
  return { ok: true };
}
