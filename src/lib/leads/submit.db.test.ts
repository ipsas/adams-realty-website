import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agents, inquiries, users } from "@/db/schema";
import type { Email } from "@/lib/email";
import { formTokenSecret, issueFormToken } from "@/lib/form-token";
import { closeDb, resetDb } from "@/test/db/helpers";
import { submitInquiry, type SubmitContext } from "./submit";

// The public lead forms end to end against the database, with the mailer
// swapped for a list: what gets stored, what gets flagged, what gets emailed.

let sent: Email[];
let agentId: string;

const deps = () => ({
  db,
  send: async (e: Email) => void sent.push(e),
  siteUrl: "https://adams.example",
  inbox: "office@adams.example",
  production: true,
});

let ipCounter = 0;
/** A fresh client address per call, so the per-IP limit doesn't carry between tests. */
const ctx = (over: Partial<SubmitContext> = {}): SubmitContext => ({
  ip: `198.51.100.${++ipCounter}`,
  userId: null,
  referer: "https://adams.example/agents/pat",
  userAgent: "Mozilla/5.0",
  ...over,
});

/** A timer token for a form that opened `ms` ago, signed by this server. */
const openedAgo = (ms: number) => issueFormToken(formTokenSecret(), Date.now() - ms);

const form = (over: Record<string, string> = {}) => ({
  type: "question",
  source: "agent",
  agentId,
  name: "Jordan Buyer",
  email: `jordan${++ipCounter}@example.com`,
  message: "Do you have anything near the lake under $300k?",
  website: "",
  formToken: openedAgo(12_000),
  ...over,
});

const PITCH =
  "Your website isn't showing up in Google's index. We can boost your search visibility: https://rank.example";

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

const row = async (id: string) =>
  (await db.select().from(inquiries).where(eq(inquiries.id, id)))[0];

describe("submitInquiry", () => {
  it("stores a real lead as new, routed to the agent, and emails the agent", async () => {
    const res = await submitInquiry(form(), ctx(), deps());
    expect(res.ok).toBe(true);
    expect(res.spam).toEqual([]);
    const lead = await row(res.id!);
    expect(lead.status).toBe("new");
    expect(lead.agentId).toBe(agentId);
    expect(lead.metadata.spam).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("pat@adams.example");
  });

  it("keeps a honeypot submission, flagged and unassigned, emails nobody, and thanks the robot as usual", async () => {
    const real = await submitInquiry(form(), ctx(), deps());
    sent = [];
    const res = await submitInquiry(form({ website: "https://spam.example" }), ctx(), deps());
    expect(res.ok).toBe(true);
    expect(res.message).toBe(real.message); // the same thank-you a person gets
    const lead = await row(res.id!);
    expect(lead.status).toBe("spam");
    expect(lead.agentId).toBeNull();
    expect(lead.metadata.spam).toBe("honeypot");
    expect(lead.metadata.routedAgentId).toBe(agentId);
    expect(sent).toEqual([]);
  });

  it("flags a form sent faster than a person types, or posted without the page's timer", async () => {
    const fast = await submitInquiry(form({ formToken: openedAgo(900) }), ctx(), deps());
    expect((await row(fast.id!)).metadata.spam).toBe("too-fast");
    const direct: Record<string, string> = form();
    delete direct.formToken;
    const bot = await submitInquiry(direct, ctx(), deps());
    expect((await row(bot.id!)).metadata.spam).toBe("no-timer");
    expect(sent).toEqual([]);
  });

  it("can't be told a time: a claimed elapsed time or a forged token counts as no timer", async () => {
    // What used to pass: the old field, set by a script.
    const claimed: Record<string, string> = { ...form(), formElapsed: "99999" };
    delete claimed.formToken;
    const a = await submitInquiry(claimed, ctx({ userAgent: "python-requests/2.32" }), deps());
    expect((await row(a.id!)).metadata.spam).toBe("no-timer");
    // A token signed with another key, and a real one with its time moved back.
    const other = issueFormToken("not-this-servers-secret-not-this-servers", Date.now() - 60_000);
    const b = await submitInquiry(form({ formToken: other }), ctx(), deps());
    expect((await row(b.id!)).metadata.spam).toBe("no-timer");
    const real = openedAgo(0);
    const [v, , nonce, mac] = real.split(".");
    const moved = [v, String(Date.now() - 60_000), nonce, mac].join(".");
    const c = await submitInquiry(form({ formToken: moved }), ctx(), deps());
    expect((await row(c.id!)).metadata.spam).toBe("no-timer");
    expect(sent).toEqual([]);
  });

  it("flags an SEO pitch from a stranger, but not the same words from someone the office works with", async () => {
    const stranger = await submitInquiry(form({ message: PITCH }), ctx(), deps());
    expect((await row(stranger.id!)).status).toBe("spam");
    expect((await row(stranger.id!)).metadata.spam).toBe("seo-pitch");
    expect(sent).toEqual([]);

    // An earlier lead from this email that an agent has contacted.
    const first = await submitInquiry(form({ email: "casey@example.com" }), ctx(), deps());
    await db.update(inquiries).set({ status: "contacted" }).where(eq(inquiries.id, first.id!));
    sent = [];
    const byEmail = await submitInquiry(
      form({ message: PITCH, email: "CASEY@example.com" }),
      ctx(),
      deps(),
    );
    expect((await row(byEmail.id!)).status).toBe("new");

    // Signed in to an account whose earlier lead an agent qualified (sent under another email).
    await db.insert(users).values({ id: "u-cust", name: "Robin", email: "robin@example.com" });
    const earlier = await submitInquiry(
      form({ email: "robin.work@example.com" }),
      ctx({ userId: "u-cust" }),
      deps(),
    );
    await db.update(inquiries).set({ status: "qualified" }).where(eq(inquiries.id, earlier.id!));
    sent = [];
    const byAccount = await submitInquiry(
      form({ message: PITCH, email: "robin@example.com" }),
      ctx({ userId: "u-cust" }),
      deps(),
    );
    expect((await row(byAccount.id!)).status).toBe("new");
    expect(sent).toHaveLength(1);
  });

  it("doesn't let a pitch through on anything the sender controls alone", async () => {
    const flagged = async (id: string) => (await row(id)).metadata.spam;
    // An agent's email, published on their profile, that has a login.
    await db.insert(users).values({ id: "u-agent", name: "Pat", email: "pat@adams.example" });
    const asAgent = await submitInquiry(
      form({ message: PITCH, email: "pat@adams.example" }),
      ctx(),
      deps(),
    );
    expect(await flagged(asAgent.id!)).toBe("seo-pitch");

    // Signed in to a brand-new account (sign-up checks no email).
    await db.insert(users).values({ id: "u-new", name: "Growth", email: "growth@example.com" });
    const signedIn = await submitInquiry(
      form({ message: PITCH, email: "growth@example.com" }),
      ctx({ userId: "u-new" }),
      deps(),
    );
    expect(await flagged(signedIn.id!)).toBe("seo-pitch");

    // A harmless first note nobody has answered yet, then the pitch.
    await submitInquiry(form({ email: "warmup@example.com" }), ctx(), deps());
    sent = [];
    const second = await submitInquiry(
      form({ message: PITCH, email: "warmup@example.com" }),
      ctx(),
      deps(),
    );
    expect(await flagged(second.id!)).toBe("seo-pitch");
    expect(sent).toEqual([]);
  });

  it("over the per-IP limit: the sender is asked to wait, and nothing is stored or sent", async () => {
    const ip = "203.0.113.77";
    const results = [];
    for (let i = 0; i < 6; i++) results.push(await submitInquiry(form(), ctx({ ip }), deps()));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, true, true, false]);
    expect(results[5].message).toMatch(/several messages in a row\. Please try again in/);
    expect(results[5].id).toBeUndefined();
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(inquiries);
    expect(count).toBe(5);
    expect(sent).toHaveLength(5);
  });

  it("over the per-email limit, from any number of addresses", async () => {
    const email = "same@example.com";
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await submitInquiry(form({ email }), ctx(), deps()));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false]);
    // The key is a hash, not the address.
    const keys = await db.execute<{ key: string }>(sql`select key from rate_limits`);
    expect(keys.rows.some((r) => r.key.includes(email))).toBe(false);
  });

  it("outside production, the loopback address isn't limited (local dev and e2e runs)", async () => {
    const results = [];
    for (let i = 0; i < 7; i++) {
      results.push(
        await submitInquiry(form(), ctx({ ip: "::1" }), { ...deps(), production: false }),
      );
    }
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("still validates first: bad input stores nothing", async () => {
    const res = await submitInquiry(form({ email: "nope" }), ctx(), deps());
    expect(res.ok).toBe(false);
    expect(res.errors?.email).toBeTruthy();
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(inquiries);
    expect(count).toBe(0);
  });
});
