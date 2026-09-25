import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { savedListings, savedSearches, users } from "@/db/schema";
import { searchHref } from "@/lib/search/params";
import type { AlertFrequency } from "./schedule";
import { HOME_ALERTS_SCOPE, type UnsubscribeTarget } from "./token";

/**
 * What a signed unsubscribe link controls, and the changes it may make. The
 * token is the authorization: it names exactly one user and one alert, so
 * these never touch anything else. Callers verify the token first.
 */

export type UnsubscribeSubject =
  | { kind: "homes"; email: string; active: boolean }
  | {
      kind: "search";
      email: string;
      name: string;
      frequency: AlertFrequency;
      active: boolean;
      searchUrl: string;
    }
  /** The saved search was deleted — nothing left to unsubscribe from. */
  | { kind: "missing"; email: string };

export async function describeSubject(
  target: UnsubscribeTarget,
): Promise<UnsubscribeSubject | null> {
  const [user] = await db
    .select({ email: users.email, homeAlerts: users.homeAlerts })
    .from(users)
    .where(eq(users.id, target.userId))
    .limit(1);
  if (!user) return null;
  if (target.scope === HOME_ALERTS_SCOPE) {
    return { kind: "homes", email: user.email, active: user.homeAlerts };
  }
  const [search] = await db
    .select({
      name: savedSearches.name,
      frequency: savedSearches.alertFrequency,
      criteria: savedSearches.criteria,
    })
    .from(savedSearches)
    .where(and(eq(savedSearches.id, target.scope), eq(savedSearches.userId, target.userId)))
    .limit(1);
  if (!search) return { kind: "missing", email: user.email };
  return {
    kind: "search",
    email: user.email,
    name: search.name,
    frequency: search.frequency,
    active: search.frequency !== "off",
    searchUrl: searchHref({ ...search.criteria, page: 1 }),
  };
}

/** Turns the alert off. Returns the saved search's previous frequency, so it can be restored. */
export async function unsubscribe(
  target: UnsubscribeTarget,
): Promise<{ previous: AlertFrequency | null }> {
  if (target.scope === HOME_ALERTS_SCOPE) {
    await db.update(users).set({ homeAlerts: false }).where(eq(users.id, target.userId));
    return { previous: null };
  }
  const owned = and(eq(savedSearches.id, target.scope), eq(savedSearches.userId, target.userId));
  const [search] = await db
    .select({ frequency: savedSearches.alertFrequency })
    .from(savedSearches)
    .where(owned)
    .limit(1);
  if (search && search.frequency !== "off") {
    await db.update(savedSearches).set({ alertFrequency: "off" }).where(owned);
  }
  return { previous: search?.frequency ?? null };
}

/**
 * Turns the alert back on, starting fresh: changes made while alerts were
 * off aren't sent after the fact.
 */
export async function resubscribe(
  target: UnsubscribeTarget,
  frequency: Exclude<AlertFrequency, "off"> = "daily",
): Promise<void> {
  const now = new Date();
  if (target.scope === HOME_ALERTS_SCOPE) {
    await setHomeAlertsFor(target.userId, true, now);
    return;
  }
  await db
    .update(savedSearches)
    .set({ alertFrequency: frequency, lastAlertedAt: now })
    .where(and(eq(savedSearches.id, target.scope), eq(savedSearches.userId, target.userId)));
}

/** users.home_alerts. Turning it on restarts every saved home's window at `now`. */
export async function setHomeAlertsFor(userId: string, enabled: boolean, now = new Date()) {
  await db.transaction(async (tx) => {
    await tx.update(users).set({ homeAlerts: enabled }).where(eq(users.id, userId));
    if (enabled) {
      await tx
        .update(savedListings)
        .set({ lastNotifiedAt: now })
        .where(eq(savedListings.userId, userId));
    }
  });
}
