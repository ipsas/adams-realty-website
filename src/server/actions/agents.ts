"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import { agents, offices } from "@/db/schema";
import {
  diffProfile,
  findTakenSlugs,
  nextAvailableSlug,
  parseAdminProfile,
  parseSelfProfile,
  toSlugBase,
  type AgentFieldErrors,
} from "@/lib/agents/admin-queries";
import { authorize, can, ForbiddenError, type Actor } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";
import { audit } from "../audit";

export type AgentFormState = {
  ok: boolean;
  message?: string;
  errors?: AgentFieldErrors;
  /** Set on a successful save so the form can remount with the stored (normalized) values. */
  savedAt?: number;
};

const INVALID: AgentFormState = { ok: false, message: "Please fix the highlighted fields." };

async function requireStaff(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new ForbiddenError("Please sign in.");
  authorize(can.viewDashboard(actor));
  return actor;
}

/** Agent details show on the homepage, the Agents pages and every listing sidebar. */
function revalidateAgentPages(...slugs: string[]) {
  revalidatePath("/");
  revalidatePath("/agents");
  for (const slug of new Set(slugs)) revalidatePath(`/agents/${slug}`);
  revalidatePath("/homes/[slug]", "page");
  revalidatePath("/sitemap.xml");
  revalidatePath("/dashboard/agents");
}

function isUniqueViolation(e: unknown): boolean {
  const err = e as { code?: string; cause?: { code?: string } } | null;
  return err?.code === "23505" || err?.cause?.code === "23505";
}

async function officeExists(id: string) {
  const [row] = await db
    .select({ id: offices.id })
    .from(offices)
    .where(eq(offices.id, id))
    .limit(1);
  return !!row;
}

const SLUG_TAKEN: AgentFormState = {
  ok: false,
  errors: { slug: "Someone just took that profile URL. Please save again." },
  message: "Please fix the highlighted fields.",
};

// ---------------------------------------------------------------------------
// Admin: create / update / deactivate
// ---------------------------------------------------------------------------

export async function createAgent(_prev: AgentFormState, form: FormData): Promise<AgentFormState> {
  const actor = await requireStaff();
  authorize(can.manageAgents(actor));
  const parsed = parseAdminProfile(Object.fromEntries(form.entries()));
  if (!parsed.ok) return { ...INVALID, errors: parsed.errors };
  const d = parsed.data;
  if (d.officeId && !(await officeExists(d.officeId)))
    return { ...INVALID, errors: { officeId: "Choose an office from the list." } };

  const base = d.slug ?? toSlugBase(d.name);
  let created: { id: string; slug: string };
  try {
    created = await db.transaction(async (tx) => {
      const slug = nextAvailableSlug(base, await findTakenSlugs(base, undefined, tx));
      const [row] = await tx
        .insert(agents)
        .values({ ...d, slug })
        .returning({ id: agents.id, slug: agents.slug });
      await audit(tx, {
        actorId: actor.userId,
        action: "agent.create",
        entityType: "agent",
        entityId: row.id,
        changes: { name: d.name, slug, isActive: d.isActive },
      });
      return row;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return SLUG_TAKEN;
    throw e;
  }

  revalidateAgentPages(created.slug);
  redirect(`/dashboard/agents/${created.id}?created=1`);
}

export async function updateAgent(_prev: AgentFormState, form: FormData): Promise<AgentFormState> {
  const actor = await requireStaff();
  authorize(can.manageAgents(actor));
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "That agent profile no longer exists." };
  const parsed = parseAdminProfile(Object.fromEntries(form.entries()));
  if (!parsed.ok) return { ...INVALID, errors: parsed.errors };
  const d = parsed.data;

  const [existing] = await db.select().from(agents).where(eq(agents.id, id.data)).limit(1);
  if (!existing) return { ok: false, message: "That agent profile no longer exists." };
  if (d.officeId && d.officeId !== existing.officeId && !(await officeExists(d.officeId)))
    return { ...INVALID, errors: { officeId: "Choose an office from the list." } };

  // A blank slug keeps the current URL; an edited one is made unique.
  const wanted = d.slug ?? existing.slug;
  let slug: string;
  try {
    slug = await db.transaction(async (tx) => {
      const next =
        wanted === existing.slug
          ? wanted
          : nextAvailableSlug(wanted, await findTakenSlugs(wanted, existing.id, tx));
      const values = { ...d, slug: next };
      await tx.update(agents).set(values).where(eq(agents.id, existing.id));
      await audit(tx, {
        actorId: actor.userId,
        action: "agent.update",
        entityType: "agent",
        entityId: existing.id,
        changes: diffProfile(existing, values),
      });
      return next;
    });
  } catch (e) {
    if (isUniqueViolation(e)) return SLUG_TAKEN;
    throw e;
  }

  revalidateAgentPages(existing.slug, slug);
  revalidatePath(`/dashboard/agents/${existing.id}`);
  return {
    ok: true,
    savedAt: Date.now(),
    message:
      slug !== wanted
        ? `Saved. /agents/${wanted} was taken, so the profile URL is /agents/${slug}.`
        : "Saved. The public profile is up to date.",
  };
}

/**
 * Hide (or restore) an agent on the public site. Their listings, leads and
 * login are left exactly as they are.
 */
export async function setAgentActive(id: string, active: boolean) {
  const actor = await requireStaff();
  authorize(can.manageAgents(actor));
  const agentId = z.uuid().parse(id);
  const isActive = z.boolean().parse(active);
  const [existing] = await db
    .select({ slug: agents.slug, isActive: agents.isActive })
    .from(agents)
    .where(eq(agents.id, agentId))
    .limit(1);
  if (!existing) return { ok: false as const, message: "That agent profile no longer exists." };
  if (existing.isActive !== isActive) {
    await db.transaction(async (tx) => {
      await tx.update(agents).set({ isActive }).where(eq(agents.id, agentId));
      await audit(tx, {
        actorId: actor.userId,
        action: isActive ? "agent.reactivate" : "agent.deactivate",
        entityType: "agent",
        entityId: agentId,
        changes: { isActive: { from: existing.isActive, to: isActive } },
      });
    });
  }
  revalidateAgentPages(existing.slug);
  revalidatePath(`/dashboard/agents/${agentId}`);
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Self-service: an agent's own public profile
// ---------------------------------------------------------------------------

/**
 * Agents edit their own bio, contact details and expertise. Visibility, order,
 * URL, office and MLS ID stay with the broker: the self-service schema drops
 * those keys, and the profile edited is always the actor's own, never one
 * named in the form.
 */
export async function updateMyProfile(
  _prev: AgentFormState,
  form: FormData,
): Promise<AgentFormState> {
  const actor = await requireStaff();
  if (!actor.agentId)
    return { ok: false, message: "Your login isn't linked to an agent profile yet." };
  authorize(can.editAgentProfile(actor, actor.agentId));
  const parsed = parseSelfProfile(Object.fromEntries(form.entries()));
  if (!parsed.ok) return { ...INVALID, errors: parsed.errors };
  const d = parsed.data;

  const [existing] = await db.select().from(agents).where(eq(agents.id, actor.agentId)).limit(1);
  if (!existing) return { ok: false, message: "Your agent profile no longer exists." };

  await db.transaction(async (tx) => {
    await tx.update(agents).set(d).where(eq(agents.id, existing.id));
    await audit(tx, {
      actorId: actor.userId,
      action: "agent.profile_update",
      entityType: "agent",
      entityId: existing.id,
      changes: diffProfile(existing, d),
    });
  });

  revalidateAgentPages(existing.slug);
  revalidatePath("/dashboard/profile");
  return {
    ok: true,
    savedAt: Date.now(),
    message: existing.isActive
      ? "Saved. Your public profile is up to date."
      : "Saved. Your profile is hidden from the public site right now — your broker can turn it back on.",
  };
}
