import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { cache } from "react";
import { db } from "@/db";
import { agents } from "@/db/schema";
import { auth } from "./auth";
import type { Actor, Role } from "./permissions";

/** The current Better Auth session, deduplicated per request. */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/**
 * The current user as an authorization `Actor` (role + linked agent profile),
 * or null when signed out. Deduplicated per request.
 */
export const getActor = cache(async (): Promise<Actor | null> => {
  const session = await getSession();
  if (!session) return null;
  const role = (session.user.role ?? "user") as Role;
  let agentId: string | null = null;
  if (role !== "user") {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(eq(agents.userId, session.user.id))
      .limit(1);
    agentId = agent?.id ?? null;
  }
  return { userId: session.user.id, role, agentId };
});

/** For pages: redirect to sign-in (and back) when signed out. */
export async function requireActor(returnTo: string): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect(`/sign-in?next=${encodeURIComponent(returnTo)}`);
  return actor;
}

/** For pages: sign-in redirect when signed out, 403 page when not permitted. */
export async function requirePermission(
  returnTo: string,
  check: (actor: Actor) => boolean,
): Promise<Actor> {
  const actor = await requireActor(returnTo);
  if (!check(actor)) forbidden();
  return actor;
}
