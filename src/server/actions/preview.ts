"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { clientIp } from "@/lib/anti-scraping";
import { env } from "@/lib/env";
import { hitFormLimits } from "@/lib/form-guard";
import {
  isApiPath,
  PREVIEW_COOKIE,
  PREVIEW_COOKIE_MAX_AGE,
  previewPassword,
} from "@/lib/preview-gate";
import { attemptUnlock } from "@/lib/preview-unlock";

/** `go`: unlocked; the form opens this route handler as a full page load. */
export type PreviewUnlockState = { error?: string; go?: string };

/**
 * The "Have a preview password?" form on /preview. On the right password it
 * sets the preview cookie (src/lib/preview-gate.ts) and goes where the visitor
 * was headed; otherwise it says why, without a hint. Checks and limits:
 * src/lib/preview-unlock.ts.
 */
export async function unlockPreview(
  _prev: PreviewUnlockState,
  form: FormData,
): Promise<PreviewUnlockState> {
  const password = previewPassword();
  const h = await headers();
  const result = await attemptUnlock(
    { password: form.get("password"), next: form.get("next") },
    {
      password,
      secret: env.BETTER_AUTH_SECRET,
      countAttempt: () => hitFormLimits(db, "preview-unlock", { ip: clientIp(h) }),
    },
  );
  // The gate was turned off since the page loaded: the site is open.
  if (!result.ok && result.reason === "off") redirect("/");
  if (!result.ok) return { error: result.message };
  (await cookies()).set(PREVIEW_COOKIE, result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PREVIEW_COOKIE_MAX_AGE,
  });
  // A link from an account email (/api/auth/…) is a route handler, which the client router
  // would fetch and replay instead of opening. Without JavaScript the redirect below is a
  // plain 303, which the browser opens itself.
  if (isApiPath(result.next) && h.has("next-action")) return { go: result.next };
  redirect(result.next);
}
