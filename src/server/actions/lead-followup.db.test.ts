import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { agents, auditLogs, inquiries, users } from "@/db/schema";
import type { Actor } from "@/lib/auth/permissions";
import { addDays, followUpDate, marketToday } from "@/lib/leads/working-hours";
import { closeDb, resetDb } from "@/test/db/helpers";

// The dashboard's lead actions against the database (site review #3, #9):
// assignment emails (sent after the response), the first-contact time, the
// "Follow up on" date and the email settings.

const h = vi.hoisted(() => ({
  actor: null as Actor | null,
  later: [] as Array<() => Promise<unknown>>,
  sent: [] as Array<{ to: string | string[]; subject: string; text: string }>,
}));
vi.mock("@/lib/auth/session", () => ({ getActor: async () => h.actor }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, updateTag: () => {} }));
vi.mock("@/lib/leads/deliver", () => ({
  afterResponse: (_label: string, task: () => Promise<unknown>) => void h.later.push(task),
}));
vi.mock("@/lib/email", () => ({
  sendEmail: async (e: (typeof h.sent)[number]) => (h.sent.push(e), { ok: true }),
}));

const { assignInquiry, updateInquiryStatus } = await import("./dashboard");
const { setLeadFollowUp } = await import("./leads");
const { setEmailSetting } = await import("./staff-settings");

let pat: string;
let sam: string;
let andreaAgent: string;
const admin: Actor = { userId: "andrea", role: "admin", agentId: null };
const patActor = (): Actor => ({ userId: "u-pat", role: "agent", agentId: pat });

/** Runs the work queued with after(), as Next does once the response is out. */
async function afterResponse() {
  const tasks = h.later.splice(0);
  await Promise.all(tasks.map((t) => t()));
}

beforeEach(async () => {
  await resetDb();
  await db.execute(sql`truncate table inquiries, audit_logs, users cascade`);
  await db.insert(users).values([
    { id: "andrea", name: "Andrea Anderegg", email: "andrea@x.com", role: "admin" },
    { id: "u-pat", name: "Pat Agent", email: "pat-login@x.com", role: "agent" },
  ]);
  [{ id: pat }, { id: sam }, { id: andreaAgent }] = await db
    .insert(agents)
    .values([
      { slug: "pat", name: "Pat Agent", email: "pat@x.com", userId: "u-pat" },
      { slug: "sam", name: "Sam Agent", email: "sam@x.com" },
      { slug: "andrea", name: "Andrea Anderegg", email: "andrea@agents.x.com", userId: "andrea" },
    ])
    .returning({ id: agents.id });
  admin.agentId = andreaAgent;
  h.actor = admin;
  h.later = [];
  h.sent = [];
});
afterAll(closeDb);

async function lead(over: Partial<typeof inquiries.$inferInsert> = {}) {
  const [row] = await db
    .insert(inquiries)
    .values({ type: "question", source: "contact", name: "Casey", email: "casey@x.com", ...over })
    .returning();
  return row;
}
const read = async (id: string) =>
  (await db.select().from(inquiries).where(eq(inquiries.id, id)))[0];

describe("assignInquiry", () => {
  it("emails the agent a lead was assigned to, after the response, with a link to it", async () => {
    const row = await lead();
    expect(await assignInquiry(row.id, pat)).toEqual({ ok: true });
    expect(h.sent).toHaveLength(0); // nothing before the response
    await afterResponse();
    expect(h.sent.map((e) => e.to)).toEqual(["pat@x.com"]);
    expect(h.sent[0].subject).toBe("Assigned to you: New question from Casey");
    expect(h.sent[0].text).toContain("Andrea Anderegg assigned this lead to you.");
    expect(h.sent[0].text).toContain(`/dashboard/leads/${row.id}`);

    // Reassigned: the new agent hears about it.
    await assignInquiry(row.id, sam);
    await afterResponse();
    expect(h.sent.map((e) => e.to)).toEqual(["pat@x.com", "sam@x.com"]);
  });

  it("sends nothing when unassigning, re-picking the same agent, self-assigning, or on spam", async () => {
    const row = await lead({ agentId: pat });
    await assignInquiry(row.id, pat);
    await assignInquiry(row.id, "");
    await assignInquiry(row.id, andreaAgent);
    const spam = await lead({ status: "spam" });
    await assignInquiry(spam.id, sam);
    await afterResponse();
    expect(h.sent).toEqual([]);
    expect((await read(row.id)).agentId).toBe(andreaAgent);
  });

  it("is admin-only", async () => {
    const row = await lead();
    h.actor = patActor();
    await expect(assignInquiry(row.id, pat)).rejects.toThrow();
    expect((await read(row.id)).agentId).toBeNull();
  });
});

describe("first contact", () => {
  it("is recorded when a lead first moves to contacted or qualified, and never moves after", async () => {
    const row = await lead({ agentId: pat });
    await updateInquiryStatus(row.id, "closed");
    expect((await read(row.id)).firstContactedAt).toBeNull();
    await updateInquiryStatus(row.id, "new");
    await updateInquiryStatus(row.id, "contacted");
    const first = (await read(row.id)).firstContactedAt;
    expect(first).toBeInstanceOf(Date);
    expect(Math.abs(first!.getTime() - Date.now())).toBeLessThan(60_000);

    await db
      .update(inquiries)
      .set({ firstContactedAt: new Date("2026-09-01T14:00:00Z") })
      .where(eq(inquiries.id, row.id));
    await updateInquiryStatus(row.id, "qualified");
    expect((await read(row.id)).firstContactedAt).toEqual(new Date("2026-09-01T14:00:00Z"));
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id));
    expect(logs.filter((l) => l.action === "inquiry.status")).toHaveLength(4);
  });
});

describe("setLeadFollowUp", () => {
  it("sets the quick dates from the market's today, a chosen date, and clears", async () => {
    const row = await lead({ agentId: pat });
    h.actor = patActor();
    for (const preset of ["tomorrow", "in3", "week"] as const) {
      const res = await setLeadFollowUp(row.id, preset);
      expect(res).toEqual({ ok: true, followUpOn: followUpDate(preset, new Date()) });
      expect((await read(row.id)).followUpOn).toBe(followUpDate(preset, new Date()));
    }
    const today = marketToday(new Date());
    expect(await setLeadFollowUp(row.id, today)).toEqual({ ok: true, followUpOn: today });
    expect(await setLeadFollowUp(row.id, "")).toEqual({ ok: true, followUpOn: null });
    expect((await read(row.id)).followUpOn).toBeNull();
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id));
    expect(logs.filter((l) => l.action === "inquiry.follow_up")).toHaveLength(5);
  });

  it("refuses past, impossible and far-off dates, and leads that aren't yours", async () => {
    const row = await lead({ agentId: pat, followUpOn: "2026-12-01" });
    h.actor = patActor();
    const today = marketToday(new Date());
    expect((await setLeadFollowUp(row.id, addDays(today, -1))).ok).toBe(false);
    expect((await setLeadFollowUp(row.id, "2027-02-31")).ok).toBe(false);
    expect((await setLeadFollowUp(row.id, "soon")).ok).toBe(false);
    expect((await setLeadFollowUp(row.id, addDays(today, 400))).ok).toBe(false);
    const sams = await lead({ agentId: sam });
    expect(await setLeadFollowUp(sams.id, "tomorrow")).toMatchObject({ ok: false });
    expect((await read(sams.id)).followUpOn).toBeNull();
    expect((await read(row.id)).followUpOn).toBe("2026-12-01");
  });
});

describe("setEmailSetting", () => {
  const me = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0];

  it("lets the broker turn copies and the summary off and on", async () => {
    expect((await me("andrea")).leadCopies).toBe(true);
    expect(await setEmailSetting("leadCopies", false)).toEqual({ ok: true, enabled: false });
    expect(await setEmailSetting("leadDigest", false)).toEqual({ ok: true, enabled: false });
    expect(await me("andrea")).toMatchObject({ leadCopies: false, leadDigest: false });
    await setEmailSetting("leadCopies", true);
    expect((await me("andrea")).leadCopies).toBe(true);
  });

  it("gives agents the summary switch only", async () => {
    h.actor = patActor();
    expect((await setEmailSetting("leadCopies", false)).ok).toBe(false);
    expect(await setEmailSetting("leadDigest", false)).toEqual({ ok: true, enabled: false });
    expect(await me("u-pat")).toMatchObject({ leadCopies: true, leadDigest: false });
    h.actor = { userId: "buyer", role: "user", agentId: null };
    expect((await setEmailSetting("leadDigest", false)).ok).toBe(false);
  });
});
