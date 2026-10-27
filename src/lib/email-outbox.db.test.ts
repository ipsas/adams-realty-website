import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, schema } from "@/db";
import { agents, emailOutbox, inquiries } from "@/db/schema";
import type { Email, SendResult } from "@/lib/email";
import { retryLeadEmails } from "@/lib/leads/outbox";
import { captureConsole } from "@/test/console";
import { closeDb, resetDb } from "@/test/db/helpers";
import {
  claimDueEmails,
  enqueueEmail,
  OUTBOX_MAX_ATTEMPTS,
  processEmailOutbox,
  type OutboxItem,
} from "./email-outbox";

// The lead-notice outbox against Postgres: concurrent runs claim disjoint
// rows, failures back off and end dead, a notice whose lead is gone is
// dropped, and the same notice is queued once.

const SITE = "https://adams.example";

/** Two connections that really run side by side. */
const wide = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
const wideDb = drizzle(wide, { schema });

const failed: SendResult = { ok: false, reason: "send_failed", status: 503 };
const email: Email = { kind: "lead-notice", to: "pat@adams.example", subject: "s", text: "t" };
const rows = () => db.select().from(emailOutbox);
const office = (entityId: string): OutboxItem => ({
  kind: "lead-notice",
  entityId,
  recipientRole: "office",
  recipientId: null,
});
/** Makes every pending row due now. */
const due = () => db.update(emailOutbox).set({ nextAttemptAt: sql`now() - interval '1 second'` });

let leadId: string;

beforeEach(async () => {
  await resetDb();
  await db.execute(sql`truncate table inquiries, email_outbox, users cascade`);
  const [agent] = await db
    .insert(agents)
    .values({ slug: "pat-agent", name: "Pat Agent", email: "pat@adams.example" })
    .returning({ id: agents.id });
  [{ id: leadId }] = await db
    .insert(inquiries)
    .values({
      type: "question",
      source: "agent",
      agentId: agent.id,
      name: "Jordan Buyer",
      email: "jordan@example.com",
      message: "Anything near the lake?",
    })
    .returning({ id: inquiries.id });
});

afterAll(async () => {
  await db.execute(sql`truncate table email_outbox`);
  await wide.end();
  await closeDb();
});

describe("enqueueEmail", () => {
  it("queues the same notice for the same recipient once; due after 15 minutes", async () => {
    captureConsole();
    await enqueueEmail(db, { ...office(leadId), lastStatus: "http_503" });
    await enqueueEmail(db, { ...office(leadId), lastStatus: "http_429" });
    await enqueueEmail(db, {
      kind: "lead-copy",
      entityId: leadId,
      recipientRole: "admin",
      recipientId: "u-1",
      lastStatus: "network",
    });
    const all = await rows();
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.kind === "lead-notice")).toMatchObject({
      attempts: 1,
      state: "pending",
      lastStatus: "http_503",
    });
    expect(await claimDueEmails(db, 10)).toEqual([]);
  });
});

describe("claimDueEmails", () => {
  it("gives two concurrent runs disjoint rows, and leases them", async () => {
    captureConsole();
    for (let i = 0; i < 6; i++)
      await enqueueEmail(db, { ...office(randomUUID()), lastStatus: "http_503" });
    await due();
    const [a, b] = await Promise.all([claimDueEmails(wideDb, 4), claimDueEmails(wideDb, 4)]);
    const ids = [...a, ...b].map((r) => r.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    // Leased: neither run (nor the next) takes them again until the lease ends.
    expect(await claimDueEmails(db, 10)).toEqual([]);
    for (const r of [...a, ...b]) expect(r.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("processEmailOutbox", () => {
  it("backs off 15 min × 2^(attempts − 1) and marks the notice dead after 6 tries", async () => {
    const { output } = captureConsole();
    await enqueueEmail(db, { ...office(leadId), lastStatus: "http_503" });
    const send = vi.fn(async () => failed);
    for (let attempts = 2; attempts <= OUTBOX_MAX_ATTEMPTS; attempts++) {
      await due();
      await processEmailOutbox({ db, send, rebuild: async () => email });
      const [row] = await rows();
      expect(row.attempts).toBe(attempts);
      if (attempts < OUTBOX_MAX_ATTEMPTS) {
        expect(row.state).toBe("pending");
        const { minutes } = (
          await db.execute<{ minutes: number }>(
            sql`select extract(epoch from next_attempt_at - now()) / 60 as minutes from email_outbox`,
          )
        ).rows[0];
        const wait = 15 * 2 ** (attempts - 1);
        expect(Number(minutes)).toBeGreaterThan(wait - 1);
        expect(Number(minutes)).toBeLessThanOrEqual(wait);
      } else {
        expect(row.state).toBe("dead");
        expect(output()).toContain(
          `[email-outbox] kind=lead-notice id=${row.id} status=dead attempts=6 last=http_503`,
        );
      }
    }
    expect(send).toHaveBeenCalledTimes(OUTBOX_MAX_ATTEMPTS - 1);
    // Dead rows are never claimed again.
    await due();
    expect(await claimDueEmails(db, 10)).toEqual([]);
  });

  it("rebuilds the notice from the lead as it is now, sends it once, and deletes the row", async () => {
    captureConsole();
    const [agent] = await db.select().from(agents);
    await enqueueEmail(db, {
      kind: "lead-notice",
      entityId: leadId,
      recipientRole: "agent",
      recipientId: agent.id,
      lastStatus: "http_503",
    });
    await due();
    const sent: Email[] = [];
    const run = await retryLeadEmails({
      send: async (e) => (sent.push(e), { ok: true }),
      siteUrl: SITE,
      inbox: "office@adams.example",
    });
    expect(run).toEqual({ sent: 1, retry: 0, dead: 0, gone: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      kind: "lead-notice",
      to: "pat@adams.example",
      replyTo: "jordan@example.com",
      idempotencyKey: expect.stringMatching(/^outbox\/[0-9a-f-]{36}\/[0-9a-f]{16}$/),
    });
    expect(sent[0].text).toContain(`${SITE}/dashboard/leads/${leadId}`);
    expect(await rows()).toEqual([]);
  });

  it("deletes the row, sending nothing, when the lead is gone or no longer the agent's", async () => {
    const { output } = captureConsole();
    const [agent] = await db.select().from(agents);
    await enqueueEmail(db, {
      kind: "lead-assignment",
      entityId: leadId,
      recipientRole: "agent",
      recipientId: randomUUID(),
      lastStatus: "http_503",
    });
    await enqueueEmail(db, {
      kind: "lead-notice",
      entityId: leadId,
      recipientRole: "agent",
      recipientId: agent.id,
      lastStatus: "http_503",
    });
    await db.delete(inquiries).where(eq(inquiries.id, leadId));
    await due();
    const send = vi.fn(async () => ({ ok: true as const }));
    const run = await retryLeadEmails({ send, siteUrl: SITE, inbox: "office@adams.example" });
    expect(run).toEqual({ sent: 0, retry: 0, dead: 0, gone: 2 });
    expect(send).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
    expect(output().filter((l) => l.includes("status=gone"))).toHaveLength(2);
  });
});
