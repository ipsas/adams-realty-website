import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";

/**
 * Signed unsubscribe links. A token names one user and one scope — a saved
 * search id, or "homes" for saved-home updates — so a forwarded email can
 * only ever turn off that one alert. Tokens are HMAC-SHA256 signed with a key
 * derived from BETTER_AUTH_SECRET (rotating the secret invalidates old links)
 * and expire after 180 days, well past CAN-SPAM's 30-day minimum.
 *
 * Format: base64url(JSON {u, s, e}) "." base64url(signature).
 */

/** Scope for price/status updates on saved homes (`users.home_alerts`). */
export const HOME_ALERTS_SCOPE = "homes";

export type UnsubscribeTarget = {
  userId: string;
  /** "homes", or a saved search id. */
  scope: string;
};

export const TOKEN_TTL_MS = 180 * 86_400_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidScope(scope: string): boolean {
  return scope === HOME_ALERTS_SCOPE || UUID.test(scope);
}

function signingKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "adams-realty", "alerts-unsubscribe-v1", 32));
}

function sign(body: string, secret: string): Buffer {
  return createHmac("sha256", signingKey(secret)).update(body).digest();
}

type Options = { secret?: string; now?: Date };

export function signUnsubscribeToken(
  target: UnsubscribeTarget,
  {
    secret = env.BETTER_AUTH_SECRET,
    now = new Date(),
    ttlMs = TOKEN_TTL_MS,
  }: Options & {
    ttlMs?: number;
  } = {},
): string {
  if (!target.userId || !isValidScope(target.scope)) throw new Error("Invalid unsubscribe target");
  const exp = Math.floor((now.getTime() + ttlMs) / 1000);
  const body = Buffer.from(JSON.stringify({ u: target.userId, s: target.scope, e: exp })).toString(
    "base64url",
  );
  return `${body}.${sign(body, secret).toString("base64url")}`;
}

/** The target a token names, or null if it's malformed, tampered with or expired. */
export function verifyUnsubscribeToken(
  token: string | null | undefined,
  { secret = env.BETTER_AUTH_SECRET, now = new Date() }: Options = {},
): UnsubscribeTarget | null {
  if (!token || token.length > 1024) return null;
  const [body, sig, ...rest] = token.split(".");
  if (!body || !sig || rest.length) return null;

  const given = Buffer.from(sig, "base64url");
  const expected = sign(body, secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  const { u, s, e } = (payload ?? {}) as Record<string, unknown>;
  if (typeof u !== "string" || !u || typeof s !== "string" || !isValidScope(s)) return null;
  if (typeof e !== "number" || e * 1000 <= now.getTime()) return null;
  return { userId: u, scope: s };
}

/** Links for an alert email: the confirm page (footer link) and the RFC 8058 one-click endpoint (header). */
export function unsubscribeUrls(target: UnsubscribeTarget, options?: Options) {
  const token = encodeURIComponent(signUnsubscribeToken(target, options));
  const base = env.NEXT_PUBLIC_SITE_URL;
  return {
    page: `${base}/alerts/unsubscribe?token=${token}`,
    oneClick: `${base}/alerts/one-click?token=${token}`,
  };
}
