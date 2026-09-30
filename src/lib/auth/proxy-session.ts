import { and, eq, gt } from "drizzle-orm";
import { getCookieCache, getSessionCookie } from "better-auth/cookies";
import type { Executor } from "@/db";
import { sessions, users } from "@/db/schema";
import type { Role } from "./permissions";

/**
 * Who is signed in, for the proxy's rate limiter (not for authorization: pages
 * and server actions still check `src/lib/auth/permissions.ts`). A cookie's
 * presence proves nothing, so it is verified:
 *
 * 1. Better Auth's signed cookie cache (HMAC with the auth secret; five
 *    minutes), with no database round trip; else
 * 2. the session token looked up in `sessions` (unexpired), joined to the
 *    user's role. The token is a long random secret, so knowing a valid one
 *    means holding that session.
 *
 * Returns null when signed out or when neither check passes.
 */

export type ProxyUser = { userId: string; role: Role };

export async function proxyUser(
  request: Request | Headers,
  db: Executor,
  secret: string,
  now: Date = new Date(),
): Promise<ProxyUser | null> {
  const signed = getSessionCookie(request);
  if (!signed) return null;
  try {
    const cached = await getCookieCache(request, { secret });
    if (cached?.user?.id) {
      return { userId: String(cached.user.id), role: roleOf(cached.user.role) };
    }
  } catch {
    // Malformed cookie: fall through to the database.
  }
  const token = sessionTokenFromCookie(signed);
  if (!token) return null;
  const [row] = await db
    .select({ userId: users.id, role: users.role })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.token, token), gt(sessions.expiresAt, now)))
    .limit(1);
  return row ? { userId: row.userId, role: row.role } : null;
}

/** Better Auth's session cookie is `<token>.<signature>`, URL-encoded. */
export function sessionTokenFromCookie(value: string): string | null {
  let v = value;
  try {
    v = decodeURIComponent(value);
  } catch {
    return null;
  }
  const token = v.split(".")[0];
  return token && /^[A-Za-z0-9_-]{16,}$/.test(token) ? token : null;
}

const roleOf = (r: unknown): Role => (r === "agent" || r === "admin" ? r : "user");
