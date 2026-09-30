import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { agents, auditLogs, inquiries, users } from "@/db/schema";
import type { Actor } from "@/lib/auth/permissions";
import { getLeads, getOverview, getSpamCount } from "@/lib/dashboard/queries";
import { closeDb, resetDb } from "@/test/db/helpers";

// Suspected spam in the dashboard: out of the counts, in the Spam tab with its
// reasons, and back to its agent when staff clear it.

const h = vi.hoisted(() => ({ actor: null as Actor | null }));
vi.mock("@/lib/auth/session", () => ({ getActor: async () => h.actor }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, updateTag: () => {} }));

const { updateInquiryStatus } = await import("./dashboard");

const admin: Actor = { userId: "u-admin", role: "admin", agentId: null };
let agentId: string;

beforeEach(async () => {
  await resetDb();
  await db.execute(sql`truncate table inquiries, audit_logs, users cascade`);
  await db
    .insert(users)
    .values({ id: "u-admin", name: "Admin", email: "admin@x.com", role: "admin" });
  [{ id: agentId }] = await db
    .insert(agents)
    .values({ slug: "pat", name: "Pat Agent", email: "pat@x.com" })
    .returning({ id: agents.id });
  h.actor = admin;
});
afterAll(closeDb);

async function lead(over: Partial<typeof inquiries.$inferInsert> = {}) {
  const [row] = await db
    .insert(inquiries)
    .values({
      type: "question",
      source: "agent",
      name: "Someone",
      email: "someone@x.com",
      ...over,
    })
    .returning();
  return row;
}

describe("suspected spam in the dashboard", () => {
  it("stays out of the open leads, this week's count and tours, and is counted in its own tab", async () => {
    await lead({ agentId });
    await lead({ type: "tour", tourAt: new Date(Date.now() + 86_400_000), agentId });
    const spam = await lead({
      status: "spam",
      type: "tour",
      tourAt: new Date(Date.now() + 86_400_000),
      metadata: { spam: "honeypot,too-fast", routedAgentId: agentId },
    });
    const { leadStats, recentLeads } = await getOverview(admin);
    expect(leadStats.thisWeek).toBe(2);
    expect(leadStats.tours).toBe(1);
    expect(recentLeads.map((l) => l.id)).not.toContain(spam.id);
    expect((await getLeads(admin)).map((l) => l.id)).not.toContain(spam.id);
    expect(await getSpamCount(admin)).toBe(1);
    const [inTab] = await getLeads(admin, { status: "spam" });
    expect(inTab.id).toBe(spam.id);
    expect(inTab.spamReasons).toBe("honeypot,too-fast");
    // Unassigned, so no agent sees it.
    expect(await getSpamCount({ userId: "u-pat", role: "agent", agentId })).toBe(0);
  });

  it("clearing it gives it back the agent it would have gone to, and records that", async () => {
    const spam = await lead({
      status: "spam",
      metadata: { spam: "seo-pitch", routedAgentId: agentId },
    });
    expect(await updateInquiryStatus(spam.id, "new")).toEqual({ ok: true });
    const [after] = await db.select().from(inquiries).where(eq(inquiries.id, spam.id));
    expect(after.status).toBe("new");
    expect(after.agentId).toBe(agentId);
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, spam.id));
    expect(logs).toHaveLength(1);
    expect(logs[0].changes).toMatchObject({ agentId, reason: "cleared from spam" });
  });

  it("leaves routing alone when it was never routed, the agent is gone, or an admin already assigned it", async () => {
    const office = await lead({
      status: "spam",
      metadata: { spam: "honeypot", routedAgentId: "" },
    });
    await updateInquiryStatus(office.id, "new");
    expect(
      (await db.select().from(inquiries).where(eq(inquiries.id, office.id)))[0].agentId,
    ).toBeNull();

    const gone = await lead({
      status: "spam",
      metadata: { spam: "honeypot", routedAgentId: "00000000-0000-4000-8000-000000000000" },
    });
    await updateInquiryStatus(gone.id, "contacted");
    expect(
      (await db.select().from(inquiries).where(eq(inquiries.id, gone.id)))[0].agentId,
    ).toBeNull();

    const [other] = await db
      .insert(agents)
      .values({ slug: "sam", name: "Sam", email: "sam@x.com" })
      .returning({ id: agents.id });
    const assigned = await lead({
      status: "spam",
      agentId: other.id,
      metadata: { spam: "honeypot", routedAgentId: agentId },
    });
    await updateInquiryStatus(assigned.id, "new");
    expect(
      (await db.select().from(inquiries).where(eq(inquiries.id, assigned.id)))[0].agentId,
    ).toBe(other.id);
  });
});
