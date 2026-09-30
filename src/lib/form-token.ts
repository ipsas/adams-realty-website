import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * The form timer's proof (src/lib/spam.ts): when a public form opens, the page asks
 * GET /api/form-token for a token that records the server's time, signed with the
 * server's secret. The form sends it back; the server reads how long ago it was issued.
 * Both times are the server's own clock, so a device's wrong clock doesn't matter, and
 * the client can't claim a number: a script has to fetch a token and then wait as long
 * as a person would (review fix round 1: `formElapsed=99999` used to pass).
 *
 * A token is good for a week (a form left open overnight still works). It isn't single
 * use: the per-address and per-email limits (./form-guard.ts) bound how often it's used.
 */

const DAY = 86_400_000;
export const FORM_TOKEN_MAX_AGE_MS = 7 * DAY;
/** How far ahead of the server's clock a token may claim to be (instances' clocks differ). */
const CLOCK_SKEW_MS = 5_000;

const sign = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(`form-token:v1:${payload}`).digest("base64url");

/** A token for a form that opens at `now`. */
export function issueFormToken(secret: string, now = Date.now()): string {
  const payload = `${now}.${randomBytes(9).toString("base64url")}`;
  return `v1.${payload}.${sign(secret, payload)}`;
}

/**
 * How long ago (ms) `token` was issued, or null when it's missing, forged, altered,
 * from the future or older than FORM_TOKEN_MAX_AGE_MS: the form wasn't opened on the
 * site (the spam reason "no-timer").
 */
export function formTokenElapsed(
  token: string | null | undefined,
  secret: string,
  now = Date.now(),
): number | null {
  const m = /^v1\.(\d{1,15})\.([A-Za-z0-9_-]{1,32})\.([A-Za-z0-9_-]{43})$/.exec(
    token?.trim() ?? "",
  );
  if (!m) return null;
  const [, issued, nonce, mac] = m;
  const expected = Buffer.from(sign(secret, `${issued}.${nonce}`));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const elapsed = now - Number(issued);
  if (elapsed < -CLOCK_SKEW_MS || elapsed > FORM_TOKEN_MAX_AGE_MS) return null;
  return Math.max(0, elapsed);
}

/** The key tokens are signed with: the auth secret, which every deployment has. */
export function formTokenSecret(): string {
  return env.BETTER_AUTH_SECRET;
}
