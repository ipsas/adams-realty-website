import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agents, inquiries, leadDigests, users } from "@/db/schema";
import type { Email } from "@/lib/email";
import { closeDb, resetDb } from "@/test/db/helpers";
import { runLeadDigests } from "./digest";

// The 7 a.m. morning summary against the database (site review #9), with the
// mailer swapped for a list. Wednesday Sep 30 2026 (EDT: 7 a.m. is 11:00 UTC).

const SITE = "https://adams.example";
const et = (day: string, time: string) => new Date(`${day}T${time}:00-04:00`);
let sent: Email[];
const send = async (e: Email) => void sent.push(e);
const run = (now: Date, over: Parameters<typeof runLeadDigests>[0] = {}) =>
  runLeadDigests({ db, now, send, siteUrl: SITE, ...over });

let pat: string;
let sam: string;

beforeEach(async () => {
  await resetDb();
  await db.execute(sql`truncate table inquiries, lead_digests, users cascade`);
  sent = [];
  await db.insert(users).values([
    { id: "andrea", name: "Andrea Anderegg", email: "andrea@adams.example", role: "admin" },
    { id: "u-pat", name: "Pat Agent", email: "pat-login@adams.example", role: "agent" },
    { id: "u-sam", name: "Sam Agent", email: "sam-login@adams.example", role: "agent" },
    { id: "buyer", name: "Jordan", email: "jordan@example.com", role: "user" },
  ]);
  [{ id: pat }, { id: sam }] = await db
    .insert(agents)
    .values([
      { slug: "pat", name: "Pat Agent", email: "pat@adams.example", userId: "u-pat" },
      { slug: "sam", name: "Sam Agent", email: "sam@adams.example", userId: "u-sam" },
      // The broker's own agent profile: her summary is the office one.
      { slug: "andrea", name: "Andrea Anderegg", email: "andrea@agents.example", userId: "andrea" },
      // No login: can't open the dashboard, so no summary.
      { slug: "lee", name: "Lee NoLogin", email: "lee@adams.example" },
    ])
    .returning({ id: agents.id });
  await db.insert(inquiries).values([
    {
      type: "question",
      source: "agent",
      name: "Waiting Wanda",
      email: "wanda@example.com",
      agentId: pat,
      createdAt: et("2026-09-25", "10:00"),
    },
    {
      type: "valuation",
      source: "sell",
      name: "Unrouted Ursula",
      email: "ursula@example.com",
      createdAt: et("2026-09-26", "10:00"),
    },
  ]);
});
afterAll(closeDb);

const byTo = () => Object.fromEntries(sent.map((e) => [String(e.to), e]));

describe("runLeadDigests", () => {
  it("does nothing before 7 a.m. Eastern (the 11:00 UTC cron in winter is 6 a.m.)", async () => {
    const res = await run(et("2026-09-30", "06:59"));
    expect(res.skipped).toBe("before-send-hour");
    expect(sent).toEqual([]);
    expect(await db.select().from(leadDigests)).toEqual([]);
  });

  it("at 7 sends the broker the office's list and each agent their own, linked to each lead", async () => {
    const res = await run(et("2026-09-30", "07:00"));
    expect(res).toMatchObject({ ok: true, day: "2026-09-30", emailed: 2, empty: 1 });
    // Andrea (office) and Pat (a lead waiting); Sam has nothing, so no email.
    expect(sent.map((e) => e.to).sort()).toEqual(["andrea@adams.example", "pat@adams.example"]);
    const mail = byTo();

    const office = mail["andrea@adams.example"];
    expect(office.subject).toBe("Today: 2 leads waiting");
    expect(office.text).toContain("Good morning, Andrea");
    expect(office.text).toContain("Unrouted Ursula (Waiting 3 days)");
    expect(office.text).toContain("Valuation request · Unassigned");
    expect(office.text).toContain("Waiting Wanda (Waiting 4 days)");
    expect(office.text).toContain("Question · Pat Agent");
    expect(office.text).toMatch(/\/dashboard\/leads\/[0-9a-f-]{36}/);

    const own = mail["pat@adams.example"];
    expect(own.subject).toBe("Today: 1 lead waiting");
    expect(own.text).toContain("Good morning, Pat");
    expect(own.text).toContain("Waiting Wanda");
    expect(own.text).not.toContain("Ursula");
    expect(own.idempotencyKey).toBe(`lead-digest:agent:${pat}:2026-09-30`);

    const claims = await db.select().from(leadDigests);
    expect(claims.map((c) => [c.recipient, c.items]).sort()).toEqual(
      [
        ["office:andrea", 2],
        [`agent:${pat}`, 1],
        [`agent:${sam}`, 0],
      ].sort(),
    );
  });

  it("sends once a day: the later cron finds the day done; the next day sends again", async () => {
    await run(et("2026-09-30", "07:05"));
    sent = [];
    const again = await run(et("2026-09-30", "08:05"));
    expect(again).toMatchObject({ emailed: 0, alreadyDone: 3 });
    expect(sent).toEqual([]);
    const tomorrow = await run(et("2026-10-01", "07:05"));
    expect(tomorrow.emailed).toBe(2);
  });

  it("gives the day back when a send fails, so the next run retries", async () => {
    const failing = async (e: Email) => {
      if (e.to === "pat@adams.example") throw new Error("provider down");
      sent.push(e);
    };
    const first = await run(et("2026-09-30", "07:05"), { send: failing });
    expect(first).toMatchObject({ ok: false, failed: 1, emailed: 1 });
    const retry = await run(et("2026-09-30", "08:05"));
    expect(retry).toMatchObject({ ok: true, emailed: 1, alreadyDone: 2 });
    expect(sent.map((e) => e.to)).toEqual(["andrea@adams.example", "pat@adams.example"]);
  });

  it("respects the Email settings switch", async () => {
    await db.execute(sql`update users set lead_digest = false where id in ('andrea', 'u-pat')`);
    const res = await run(et("2026-09-30", "07:05"));
    expect(res.recipients).toBe(1); // Sam only
    expect(sent).toEqual([]);
  });

  it("stops starting new summaries at the deadline", async () => {
    const res = await run(et("2026-09-30", "07:05"), { deadline: Date.now() - 1 });
    expect(res.deferred).toBe(3);
    expect(sent).toEqual([]);
    expect(await db.select().from(leadDigests)).toEqual([]);
  });
});
