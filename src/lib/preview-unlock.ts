import { retryPhrase } from "@/lib/form-guard";
import { previewNext, previewPasswordMatches, previewToken } from "@/lib/preview-gate";
import type { LimitResult } from "@/lib/rate-limit-db";

/**
 * The unlock form on /preview (server action in src/server/actions/preview.ts):
 * checks a typed password against PREVIEW_PASSWORD, at most 10 tries per
 * address per 15 minutes (`FORM_LIMITS["preview-unlock"]`, counted in
 * Postgres like the other forms, right or wrong). If the limiter can't reach
 * the database, unlocking fails closed ("try again later"); the page itself
 * never needs the database. A wrong password gets no hint.
 */

export type UnlockDeps = {
  /** The configured password (null: the gate is off). */
  password: string | null;
  secret: string;
  /** Counts one attempt from this visitor; throws when the database is unreachable. */
  countAttempt(): Promise<LimitResult>;
};

export type UnlockResult =
  | { ok: true; token: string; next: string }
  | { ok: false; reason: "off" | "empty" | "wrong" | "busy" | "unavailable"; message: string };

/** Longer than any password anyone types; anything past it isn't one. */
const MAX_LENGTH = 200;

export async function attemptUnlock(
  input: { password: unknown; next: unknown },
  deps: UnlockDeps,
): Promise<UnlockResult> {
  if (!deps.password) return { ok: false, reason: "off", message: "" };
  const typed = typeof input.password === "string" ? input.password : "";
  if (!typed.trim()) {
    return { ok: false, reason: "empty", message: "Enter the preview PIN." };
  }
  let limited: LimitResult;
  try {
    limited = await deps.countAttempt();
  } catch (e) {
    console.error("[preview] attempt limiter unavailable; not unlocking", e);
    return {
      ok: false,
      reason: "unavailable",
      message: "We couldn't check that just now. Please try again later.",
    };
  }
  if (!limited.ok) {
    return {
      ok: false,
      reason: "busy",
      message: `Too many tries from here. Please try again in ${retryPhrase(limited.retryAfter)}.`,
    };
  }
  const right =
    typed.length <= MAX_LENGTH && (await previewPasswordMatches(typed, deps.password, deps.secret));
  if (!right) {
    return { ok: false, reason: "wrong", message: "That PIN didn't work. Please try again." };
  }
  return {
    ok: true,
    token: await previewToken(deps.password, deps.secret),
    next: previewNext(input.next),
  };
}
