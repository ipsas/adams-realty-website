import { afterEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import type { SendResult } from "@/lib/email";
import { createBatchBudget } from "@/lib/email-batch";
import { captureConsole } from "@/test/console";
import { runLeadDigests } from "./digest";

vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  return { ...mod, env: { ...mod.env, RESEND_API_KEY: undefined } };
});
// Every recipient has one lead waiting; the email itself is beside the point here.
vi.mock("./attention", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./attention")>()),
  getNeedsAttention: async () => {
    const empty = { items: [], total: 0 };
    return {
      waiting: { items: [], total: 1 },
      tours: empty,
      followUps: empty,
      today: "2026-09-30",
    };
  },
}));

afterEach(() => vi.restoreAllMocks());

/** A database that records every use: the run must not touch it. */
function untouchedDb() {
  const used: string[] = [];
  const db = new Proxy(
    {},
    {
      get: (_t, prop) => (
        used.push(String(prop)),
        () => {
          throw new Error("db used");
        }
      ),
    },
  );
  return { db: db as Executor, used };
}

describe("morning summary with no Resend key", () => {
  it("skips before claiming any day, and logs one line without addresses", async () => {
    const { output } = captureConsole();
    const { db, used } = untouchedDb();
    const res = await runLeadDigests({ db, now: new Date("2026-09-30T08:05:00-04:00") });
    expect(res).toMatchObject({ ok: true, skipped: "email-not-configured", emailed: 0, failed: 0 });
    expect(used).toEqual([]);
    expect(output()).toEqual(["[digest] skipped: email not configured"]);
  });

  it("still waits for the send hour first", async () => {
    captureConsole();
    const { db } = untouchedDb();
    const res = await runLeadDigests({ db, now: new Date("2026-09-30T05:00:00-04:00") });
    expect(res.skipped).toBe("before-send-hour");
  });
});

/**
 * Three admins with summaries on, `done` of them already claimed today;
 * records which days get claimed in lead_digests and how many selects ran.
 */
function digestDb(done: string[] = []) {
  const admins = ["Ann A", "Bea B", "Cy C"].map((name, i) => ({
    id: `a${i + 1}`,
    name,
    email: `admin${i + 1}@example.com`,
  }));
  const claimed: string[] = [];
  const deleted: number[] = [];
  let selects = 0;
  const select = () => {
    // Admins, agent logins, then today's claimed recipients.
    const n = selects++;
    const rows = n === 0 ? admins : n === 1 ? [] : done.map((recipient) => ({ recipient }));
    const q = {
      from: () => q,
      innerJoin: () => q,
      where: () => q,
      orderBy: async () => rows,
      then: (resolve: (r: unknown) => void) => resolve(rows),
    };
    return q;
  };
  const db = {
    get selects() {
      return selects;
    },
    select,
    insert: () => ({
      values: (v: { recipient: string }) => ({
        onConflictDoNothing: () => ({
          returning: async () => (claimed.push(v.recipient), [{ recipient: v.recipient }]),
        }),
      }),
    }),
    update: () => ({ set: () => ({ where: async () => {} }) }),
    delete: () => ({ where: async () => void deleted.push(1) }),
  };
  return { db: db as unknown as Executor, claimed, deleted, selects: () => db.selects };
}

const counterOf = (period: string | null) => {
  const c = { reserves: 0, refunds: 0 };
  return {
    c,
    counter: {
      reserve: async () => (c.reserves++, period),
      refund: async () => void c.refunds++,
    },
  };
};

describe("morning summary under the batch-mail guard", () => {
  const now = new Date("2026-09-30T08:05:00-04:00");
  const send = vi.fn(async (): Promise<SendResult> => ({ ok: true }));

  it("claims no day for anyone once the budget is used up", async () => {
    captureConsole();
    const { db, claimed } = digestDb();
    const budget = createBatchBudget({ counter: counterOf(null).counter });
    const res = await runLeadDigests({ db, now, send, budget });
    expect(claimed).toEqual([]);
    expect(res).toMatchObject({ recipients: 3, deferred: 3, emailed: 0 });
  });

  it("stops at the per-run cap; the rest stay unclaimed for the next run", async () => {
    captureConsole();
    const { db, claimed } = digestDb();
    const budget = createBatchBudget({ runCap: 2, counter: counterOf("2026-09-30").counter });
    const res = await runLeadDigests({ db, now, send, budget });
    expect(claimed).toEqual(["office:a1", "office:a2"]);
    expect(res).toMatchObject({ recipients: 3, emailed: 2, deferred: 1 });
  });

  it("defers on a 429: gives the day back and leaves the others unclaimed", async () => {
    const { output } = captureConsole();
    const { db, claimed, deleted } = digestDb();
    const limited = vi.fn(async (): Promise<SendResult> => ({ ok: false, reason: "rate_limited" }));
    const { c, counter } = counterOf("2026-09-30");
    const budget = createBatchBudget({ counter });
    const res = await runLeadDigests({ db, now, send: limited, budget });
    expect(limited).toHaveBeenCalledTimes(1);
    expect(claimed).toEqual(["office:a1"]);
    expect(deleted).toHaveLength(1);
    expect(c).toEqual({ reserves: 1, refunds: 1 });
    expect(res).toMatchObject({ ok: true, failed: 0, deferred: 3, emailed: 0 });
    expect(output().filter((l) => l.startsWith("[email-batch]"))).toHaveLength(1);
  });

  it("skips recipients already claimed today without reserving a send", async () => {
    captureConsole();
    const { db, claimed } = digestDb(["office:a1", "office:a3"]);
    const { c, counter } = counterOf(null); // budget used up: they still aren't "deferred"
    const res = await runLeadDigests({ db, now, send, budget: createBatchBudget({ counter }) });
    expect(claimed).toEqual([]);
    expect(c.reserves).toBe(1);
    expect(res).toMatchObject({ recipients: 3, alreadyDone: 2, deferred: 1, emailed: 0 });
  });

  it("costs only the recipient and claimed-list queries once everyone is done", async () => {
    captureConsole();
    const { db, claimed, selects } = digestDb(["office:a1", "office:a2", "office:a3"]);
    const { c, counter } = counterOf("2026-09-30");
    const res = await runLeadDigests({ db, now, send, budget: createBatchBudget({ counter }) });
    expect(res).toMatchObject({ ok: true, recipients: 3, alreadyDone: 3, deferred: 0 });
    expect(selects()).toBe(3); // admins + agent logins (one recipients query), claimed list
    expect(claimed).toEqual([]);
    expect(c).toEqual({ reserves: 0, refunds: 0 });
  });
});
