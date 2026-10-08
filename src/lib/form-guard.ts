import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { ipPlans, isLoopback, normalizeIp } from "@/lib/anti-scraping";
import { FORM_TOKEN_MAX_LEADS } from "@/lib/form-token";
import { hitRateLimits, type LimitResult, type LimitWindow } from "@/lib/rate-limit-db";

/**
 * Submission limits for the public forms, per client IP, per email address
 * and per account, counted in Postgres (`rate_limits`, the same table and
 * statement as the listing limiter), so they hold across serverless
 * instances. An IPv6 client counts by its /64, or its /48 for the daily
 * windows (`ipLimitSubject` in ./anti-scraping.ts), so rotating addresses
 * within its block doesn't reset them. Emails are hashed in the counter keys.
 * Outside production, loopback addresses (`next dev`, e2e runs) aren't
 * counted by IP.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type FormKind = "inquiry" | "signup" | "saved-search" | "preview-unlock";

export const FORM_LIMITS: Record<
  FormKind,
  { ip: LimitWindow[]; email?: LimitWindow[]; account?: LimitWindow[] }
> = {
  inquiry: {
    ip: [
      { name: "inquiry-ip:10m", limit: 5, ms: 10 * MINUTE },
      { name: "inquiry-ip:1d", limit: 30, ms: DAY },
    ],
    email: [
      { name: "inquiry-email:10m", limit: 3, ms: 10 * MINUTE },
      { name: "inquiry-email:1d", limit: 10, ms: DAY },
    ],
  },
  signup: {
    ip: [
      { name: "signup-ip:1h", limit: 5, ms: HOUR },
      { name: "signup-ip:1d", limit: 20, ms: DAY },
    ],
    email: [{ name: "signup-email:1h", limit: 3, ms: HOUR }],
  },
  "saved-search": {
    ip: [{ name: "saved-search-ip:1h", limit: 40, ms: HOUR }],
    account: [
      { name: "saved-search-user:1h", limit: 20, ms: HOUR },
      { name: "saved-search-user:1d", limit: 60, ms: DAY },
    ],
  },
  /** Preview password attempts on /preview (src/lib/preview-unlock.ts): right or wrong. */
  "preview-unlock": {
    ip: [{ name: "preview-unlock-ip:15m", limit: 10, ms: 15 * MINUTE }],
  },
};

/** Leads per form timer token (./form-token.ts): a day's window, as long as a token lives. */
export const LEAD_TOKEN_LIMIT: LimitWindow[] = [
  { name: "lead-token:1d", limit: FORM_TOKEN_MAX_LEADS, ms: DAY },
];

/**
 * Counts one lead sent with the form token `tokenId`; false once the token has carried
 * more than FORM_TOKEN_MAX_LEADS (the lead is then flagged "reused-timer"). Not by
 * address: the token is what a script would reuse from every address.
 */
export async function countLeadToken(
  db: Executor,
  tokenId: string,
  now: Date = new Date(),
): Promise<boolean> {
  return (await hitRateLimits(db, `token:${tokenId}`, LEAD_TOKEN_LIMIT, now)).ok;
}

/** A stable, non-reversible key for an email address. */
export function emailKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex").slice(0, 32);
}

/** Counts one submission; not ok when any of its IP, email or account windows is over. */
export async function hitFormLimits(
  db: Executor,
  form: FormKind,
  who: { ip: string | null; email?: string | null; userId?: string | null },
  opts: { production?: boolean; now?: Date } = {},
): Promise<LimitResult> {
  const production = opts.production ?? process.env.NODE_ENV === "production";
  const now = opts.now ?? new Date();
  const limits = FORM_LIMITS[form];
  const checks: Promise<LimitResult>[] = [];
  const ip = who.ip ? normalizeIp(who.ip) : null;
  if (ip && !(!production && isLoopback(ip))) {
    // An IPv6 client is counted by its /64 (its /48 for a day), like the listing limiter.
    for (const p of ipPlans(ip, limits.ip, 1))
      checks.push(hitRateLimits(db, p.subject, p.windows, now));
  }
  if (limits.email && who.email) {
    checks.push(hitRateLimits(db, emailKey(who.email), limits.email, now));
  }
  if (limits.account && who.userId) {
    checks.push(hitRateLimits(db, who.userId, limits.account, now));
  }
  const results = await Promise.all(checks);
  const over = results.filter((r) => !r.ok).sort((a, b) => b.retryAfter - a.retryAfter)[0];
  return over ?? { ok: true, retryAfter: 0, exceeded: null };
}

/**
 * Someone the office has actually worked with: an earlier lead from this email,
 * or from this signed-in account, that staff moved on from "new" (contacted,
 * qualified or closed). The content filter never flags them.
 *
 * Nothing the sender controls alone counts (review fix round 1): not an
 * account under the typed email (sign-up checks no email, and agents' emails
 * are on their public pages), not being signed in (anyone can make an
 * account), and not an earlier message that nobody has answered yet (one
 * harmless note would clear the way for a pitch).
 */
export async function isKnownCustomer(
  db: Executor,
  email: string,
  userId: string | null,
): Promise<boolean> {
  const { rows } = await db.execute<{ known: boolean }>(sql`
    select exists (
      select 1 from inquiries i
       where i.status in ('contacted', 'qualified', 'closed')
         and (lower(i.email) = lower(${email}) or (${userId}::text is not null and i.user_id = ${userId}))
    ) as known`);
  const [row] = rows;
  return !!row?.known;
}

/** "a few minutes", "about 40 minutes", "about 2 hours": for "please try again in …". */
export function retryPhrase(seconds: number): string {
  if (seconds <= 5 * 60) return "a few minutes";
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 90) return `about ${minutes} minutes`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} ${hours === 1 ? "hour" : "hours"}`;
}
