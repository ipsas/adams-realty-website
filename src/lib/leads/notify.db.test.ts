import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agents, inquiries, users } from "@/db/schema";
import type { Email } from "@/lib/email";
import { closeDb, resetDb } from "@/test/db/helpers";
import { sendLeadAssignedEmail } from "./notify";
import { submitInquiry, type SubmitContext, type SubmitDeps } from "./submit";

// Lead emails against the database (site review #3), with the mailer swapped
// for a list: who gets each new lead, the broker's copies, the assignment
// email, and the link to the lead itself.

const SITE = "https://adams.example";
let sent: Email[];
let agentId: string;

const deps = (over: Partial<SubmitDeps> = {}): SubmitDeps => ({
  db,
  send: async (e: Email) => void sent.push(e),
  siteUrl: SITE,
  inbox: "office@adams.example",
  production: true,
  ...over,
});

let n = 0;
const ctx = (): SubmitContext => ({
  ip: `203.0.113.${++n}`,
  userId: null,
  referer: `${SITE}/agents/pat`,
  userAgent: "Mozilla/5.0",
});
const form = (over: Record<string, string> = {}) => ({
  type: "question",
  source: "agent",
  agentId,
  name: "Jordan Buyer",
  email: `jordan${++n}@example.com`,
  message: "Anything near the lake under $300k?",
  website: "",
  formElapsed: "12000",
  ...over,
});

async function admin(id: string, over: Partial<typeof users.$inferInsert> = {}) {
  await db.insert(users).values({
    id,
    name: "Andrea Anderegg",
    email: `${id}@adams.example`,
    role: "admin",
    ...over,
  });
}

beforeEach(async () => {
  await resetDb();
  await db.execute(sql`truncate table inquiries, rate_limits, users cascade`);
  sent = [];
  [{ id: agentId }] = await db
    .insert(agents)
    .values({ slug: "pat-agent", name: "Pat Agent", email: "pat@adams.example" })
    .returning({ id: agents.id });
});
afterAll(closeDb);

describe("a new lead's emails", () => {
  it("go to the agent and, by default, a copy to the broker; both open the lead itself", async () => {
    await admin("andrea");
    const res = await submitInquiry(form(), ctx(), deps());
    expect(sent.map((e) => e.to)).toEqual(["pat@adams.example", "andrea@adams.example"]);
    const [agentMail, copy] = sent;
    const link = `${SITE}/dashboard/leads/${res.id}`;
    expect(agentMail.text).toContain(`Open this lead: ${link}`);
    expect(agentMail.text).toContain("Assigned to Pat Agent. Reply to this email");
    expect(copy.text).toContain(`Open this lead: ${link}`);
    expect(copy.text).toContain("Your copy: this lead went to Pat Agent.");
    expect(copy.text).toContain(`${SITE}/dashboard/settings`);
    // Replies from either go to the buyer.
    expect(copy.replyTo).toBe(agentMail.replyTo);
    expect(copy.idempotencyKey).not.toBe(agentMail.idempotencyKey);
  });

  it("send no copy to a broker who turned copies off, nor to staff who aren't admins", async () => {
    await admin("andrea", { leadCopies: false });
    await db
      .insert(users)
      .values({ id: "sam", name: "Sam", email: "sam@adams.example", role: "agent" });
    await submitInquiry(form(), ctx(), deps());
    expect(sent.map((e) => e.to)).toEqual(["pat@adams.example"]);
  });

  it("don't send the broker a second copy of a lead that went to her", async () => {
    await admin("andrea");
    await db.update(agents).set({ userId: "andrea" }).where(eq(agents.id, agentId));
    await submitInquiry(form(), ctx(), deps());
    expect(sent.map((e) => e.to)).toEqual(["pat@adams.example"]);

    // Unassigned, to an inbox that is her own address: one email.
    sent = [];
    await submitInquiry(
      form({ source: "contact", agentId: "" }),
      ctx(),
      deps({ inbox: "Andrea@adams.example" }),
    );
    expect(sent.map((e) => e.to)).toEqual(["Andrea@adams.example"]);
  });

  it("copy an unassigned lead, saying it needs routing", async () => {
    await admin("andrea");
    await submitInquiry(form({ source: "contact", agentId: "" }), ctx(), deps());
    expect(sent.map((e) => e.to)).toEqual(["office@adams.example", "andrea@adams.example"]);
    expect(sent[1].text).toContain("went to the office inbox and isn't assigned");
  });

  it("copy no suspected spam and no listing problem report", async () => {
    await admin("andrea");
    await submitInquiry(form({ website: "https://spam.example" }), ctx(), deps());
    expect(sent).toEqual([]);
    await submitInquiry(
      form({ source: "report", agentId: "", message: "Wrong price" }),
      ctx(),
      deps(),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toMatch(/^Listing problem report/);
  });

  it("with `defer`, are sent only when the deferred task runs (after the response)", async () => {
    await admin("andrea");
    const later: Array<() => Promise<unknown>> = [];
    const res = await submitInquiry(form(), ctx(), deps({ defer: (t) => void later.push(t) }));
    expect(res.ok).toBe(true);
    expect(sent).toEqual([]);
    expect(later).toHaveLength(1);
    await later[0]();
    expect(sent.map((e) => e.to)).toEqual(["pat@adams.example", "andrea@adams.example"]);
  });

  it("still copy the broker when the agent's email fails", async () => {
    await admin("andrea");
    const send = async (e: Email) => {
      if (e.to === "pat@adams.example") throw new Error("mailbox full");
      sent.push(e);
    };
    const res = await submitInquiry(form(), ctx(), deps({ send }));
    expect(res.ok).toBe(true);
    expect(sent.map((e) => e.to)).toEqual(["andrea@adams.example"]);
  });
});

describe("sendLeadAssignedEmail", () => {
  async function lead(over: Partial<typeof inquiries.$inferInsert> = {}) {
    const [row] = await db
      .insert(inquiries)
      .values({
        type: "question",
        source: "contact",
        name: "Casey Seller",
        email: "casey@example.com",
        message: "What's my house worth?",
        agentId,
        ...over,
      })
      .returning();
    return row;
  }
  const mail = { db, send: async (e: Email) => void sent.push(e), siteUrl: SITE };

  it("tells the agent who assigned it, links the lead, and lets them reply to the buyer", async () => {
    const row = await lead();
    const to = await sendLeadAssignedEmail(mail, {
      inquiryId: row.id,
      agentId,
      assignedBy: { userId: "andrea", name: "Andrea Anderegg" },
    });
    expect(to).toBe("pat@adams.example");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "pat@adams.example", replyTo: "casey@example.com" });
    expect(sent[0].subject).toBe("Assigned to you: New question from Casey Seller");
    expect(sent[0].text).toContain("Andrea Anderegg assigned this lead to you.");
    expect(sent[0].text).toContain(`Open this lead: ${SITE}/dashboard/leads/${row.id}`);
  });

  it("stays quiet when the admin assigned it to herself, or it was reassigned meanwhile", async () => {
    await admin("andrea");
    await db.update(agents).set({ userId: "andrea" }).where(eq(agents.id, agentId));
    const mine = await lead();
    expect(
      await sendLeadAssignedEmail(mail, {
        inquiryId: mine.id,
        agentId,
        assignedBy: { userId: "andrea", name: "Andrea Anderegg" },
      }),
    ).toBeNull();
    const moved = await lead({ agentId: null });
    expect(
      await sendLeadAssignedEmail(mail, {
        inquiryId: moved.id,
        agentId,
        assignedBy: { userId: "someone", name: "Someone" },
      }),
    ).toBeNull();
    expect(sent).toEqual([]);
  });
});
