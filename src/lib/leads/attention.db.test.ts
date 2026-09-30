import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { agents, inquiries } from "@/db/schema";
import { closeDb, resetDb } from "@/test/db/helpers";
import { attentionCount, followUpOverdue, getNeedsAttention, getReplyTimes } from "./attention";

// "Needs attention" and reply times against the database (site review #9), at a
// fixed moment: Wednesday Sep 30 2026, 2 pm Eastern. A new lead is waiting too
// long once it has waited 2 office hours: created at or before noon today.

const et = (day: string, time: string) => new Date(`${day}T${time}:00-04:00`);
const NOW = et("2026-09-30", "14:00");
const HOUR = 3_600_000;

let pat: string;
let sam: string;

async function lead(name: string, over: Partial<typeof inquiries.$inferInsert> = {}) {
  const [row] = await db
    .insert(inquiries)
    .values({
      type: "question",
      source: "contact",
      name,
      email: `${name.toLowerCase().replace(/\W/g, "")}@example.com`,
      createdAt: et("2026-09-30", "13:30"),
      ...over,
    })
    .returning();
  return row;
}

beforeEach(async () => {
  await resetDb();
  await db.execute(sql`truncate table inquiries cascade`);
  [{ id: pat }, { id: sam }] = await db
    .insert(agents)
    .values([
      { slug: "pat", name: "Pat Agent", email: "pat@x.com" },
      { slug: "sam", name: "Sam Agent", email: "sam@x.com" },
    ])
    .returning({ id: agents.id });
});
afterAll(closeDb);

const names = (l: { items: { name: string }[] }) => l.items.map((i) => i.name);

describe("getNeedsAttention", () => {
  it("waiting too long: new leads past 2 office hours, oldest first; not contacted, not spam", async () => {
    await lead("Yesterday", { agentId: pat, createdAt: et("2026-09-29", "16:00") });
    await lead("At noon", { agentId: pat, createdAt: et("2026-09-30", "12:00") });
    await lead("Last week", { agentId: sam, createdAt: et("2026-09-22", "10:00") });
    await lead("Just now", { agentId: pat, createdAt: et("2026-09-30", "12:30") });
    await lead("Called back", {
      agentId: pat,
      status: "contacted",
      createdAt: et("2026-09-22", "10:00"),
    });
    await lead("Robot", { status: "spam", createdAt: et("2026-09-22", "10:00") });
    await lead("Nobody's", { createdAt: et("2026-09-28", "10:00") });

    const office = await getNeedsAttention(db, { kind: "office" }, NOW);
    expect(names(office.waiting)).toEqual(["Last week", "Nobody's", "Yesterday", "At noon"]);
    expect(office.waiting.total).toBe(4);
    expect(office.waiting.items[1].agentName).toBeNull();

    const mine = await getNeedsAttention(db, { kind: "agent", agentId: pat }, NOW);
    expect(names(mine.waiting)).toEqual(["Yesterday", "At noon"]);
  });

  it("tours: the next 48 hours, soonest first, open leads only", async () => {
    const tour = (name: string, inHours: number, over = {}) =>
      lead(name, {
        type: "tour",
        agentId: pat,
        tourAt: new Date(NOW.getTime() + inHours * HOUR),
        status: "contacted",
        ...over,
      });
    await tour("Tomorrow", 20);
    await tour("In two hours", 2);
    await tour("Day after", 47);
    await tour("Too far", 49);
    await tour("Already", -1);
    await tour("Cancelled", 5, { status: "closed" });
    await tour("Robot", 5, { status: "spam" });
    const a = await getNeedsAttention(db, { kind: "office" }, NOW);
    expect(names(a.tours)).toEqual(["In two hours", "Tomorrow", "Day after"]);
  });

  it("follow-ups: due today or earlier (the market's today), open leads only", async () => {
    await lead("Today", { agentId: pat, status: "contacted", followUpOn: "2026-09-30" });
    await lead("Monday", { agentId: pat, status: "qualified", followUpOn: "2026-09-28" });
    await lead("Tomorrow", { agentId: pat, status: "contacted", followUpOn: "2026-10-01" });
    await lead("Done", { agentId: pat, status: "closed", followUpOn: "2026-09-29" });
    await lead("Sam's", { agentId: sam, status: "contacted", followUpOn: "2026-09-30" });

    const a = await getNeedsAttention(db, { kind: "agent", agentId: pat }, NOW);
    expect(a.today).toBe("2026-09-30");
    expect(names(a.followUps)).toEqual(["Monday", "Today"]);
    expect(followUpOverdue(a.followUps.items[0].followUpOn, a.today)).toBe("Was due Mon, Sep 28");
    expect(followUpOverdue(a.followUps.items[1].followUpOn, a.today)).toBeNull();
    // 11 pm Eastern is still Sep 30 locally, though it's Oct 1 in UTC: "Tomorrow" isn't due yet.
    const late = await getNeedsAttention(
      db,
      { kind: "agent", agentId: pat },
      et("2026-09-30", "23:00"),
    );
    expect(names(late.followUps)).toEqual(["Monday", "Today"]);
  });

  it("counts every list in full even when it shows only the first few", async () => {
    for (let i = 0; i < 4; i++)
      await lead(`Old ${i}`, { agentId: pat, createdAt: et("2026-09-2" + i, "10:00") });
    const a = await getNeedsAttention(db, { kind: "office" }, NOW, { limit: 2 });
    expect(a.waiting.items).toHaveLength(2);
    expect(a.waiting.total).toBe(4);
    expect(attentionCount(a)).toBe(4);
  });
});

describe("getReplyTimes", () => {
  it("averages office time from arrival to first contact per agent, and counts who's waiting", async () => {
    // Pat: 1 h and 3 h of office time (the second arrived Friday 4 pm, answered Monday 11 am).
    await lead("A", {
      agentId: pat,
      status: "contacted",
      createdAt: et("2026-09-29", "10:00"),
      firstContactedAt: et("2026-09-29", "11:00"),
    });
    await lead("B", {
      agentId: pat,
      status: "qualified",
      createdAt: et("2026-09-25", "16:00"),
      firstContactedAt: et("2026-09-28", "11:00"),
    });
    // Before first contact was recorded: no time, so it doesn't count.
    await lead("C", { agentId: pat, status: "contacted", createdAt: et("2026-09-29", "10:00") });
    // Older than the window.
    await lead("D", {
      agentId: pat,
      status: "closed",
      createdAt: et("2026-05-01", "10:00"),
      firstContactedAt: et("2026-05-04", "10:00"),
    });
    // Sam has replied to nothing yet and has one waiting too long.
    await lead("E", { agentId: sam, createdAt: et("2026-09-29", "10:00") });

    const rows = await getReplyTimes(db, NOW);
    expect(rows).toEqual([
      { agentId: pat, agentName: "Pat Agent", replied: 2, averageMs: 2 * HOUR, waitingNow: 0 },
      { agentId: sam, agentName: "Sam Agent", replied: 0, averageMs: null, waitingNow: 1 },
    ]);
  });
});
