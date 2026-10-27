import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import type { Email, SendEmail, SendResult } from "@/lib/email";
import { captureConsole } from "@/test/console";

const h = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  /** What the default database (`@/db`) was asked; `fail` makes it throw. */
  queries: [] as { sql: string; params: unknown[] }[],
  fail: false,
}));
vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  Object.assign(h.env, mod.env, { RESEND_API_KEY: undefined });
  return { ...mod, env: h.env };
});
vi.mock("@/db", async () => {
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const dialect = new PgDialect();
  return {
    db: {
      execute: async (q: SQL) => {
        if (h.fail) throw new Error("connect ECONNREFUSED pat.buyer@example.com");
        h.queries.push(dialect.sqlToQuery(q));
        return { rows: [] };
      },
    },
  };
});

const {
  activateEmailAlerts,
  countSent,
  createBatchBudget,
  pruneSendCounters,
  sendCounter,
  BATCH_DAILY_TOTAL_LIMIT,
  BATCH_MONTHLY_TOTAL_LIMIT,
  SEND_COUNTER_LOCK,
} = await import("./email-batch");
const { sendEmail } = await import("./email");

const dialect = new PgDialect();

let output: () => string[];
beforeEach(() => {
  ({ output } = captureConsole());
  h.env.RESEND_API_KEY = undefined;
  h.queries = [];
  h.fail = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mail = (
  kind: Email["kind"] = "search-alert",
  to: Email["to"] = "pat.buyer@example.com",
): Email => ({
  kind,
  to,
  subject: "3 new homes for Lake Hartwell",
  text: "body",
});

/** An in-memory send counter with `limit` batch sends left today. */
function fakeCounter(limit: number, period = "2026-10-27") {
  const c = { batch: 0, reserves: 0, refunds: [] as string[] };
  return {
    c,
    counter: {
      reserve: async () => {
        c.reserves++;
        if (c.batch >= limit) return null;
        c.batch++;
        return period;
      },
      refund: async (p: string) => {
        c.refunds.push(p);
        c.batch--;
      },
    },
  };
}

const sender = (...results: SendResult[]): SendEmail & { calls: number } => {
  const fn = Object.assign(
    async () => {
      fn.calls++;
      return results.shift() ?? { ok: true as const };
    },
    { calls: 0 },
  );
  return fn;
};

describe("createBatchBudget", () => {
  it("stops at the per-run cap before reserving more, and logs it once", async () => {
    const { c, counter } = fakeCounter(100);
    const budget = createBatchBudget({ runCap: 2, counter });
    const send = sender();
    for (let i = 0; i < 2; i++) {
      const slot = (await budget.reserve(send))!;
      expect((await slot.send(mail())).ok).toBe(true);
      await slot.release();
    }
    expect(await budget.reserve(send)).toBeNull();
    expect(await budget.reserve(send)).toBeNull();
    expect(c).toMatchObject({ batch: 2, reserves: 2, refunds: [] });
    expect(output()).toEqual([
      "[email-batch] per-run cap (2) reached; the rest waits for the next run",
    ]);
  });

  it("refunds a reservation whose email didn't go; only an unsent try frees its run-cap place", async () => {
    const { c, counter } = fakeCounter(100);
    const budget = createBatchBudget({ runCap: 2, counter });
    // Claimed elsewhere / nothing to say: no send at all, its place is free again.
    await (await budget.reserve(sender()))!.release();
    // A failed send (not a 429): refunded in the counter, but it used a place.
    const failing = (await budget.reserve(sender({ ok: false, reason: "send_failed" })))!;
    await failing.send(mail());
    expect(failing.rateLimited).toBe(false);
    await failing.release();
    await failing.release(); // a second release is a no-op
    expect(c).toMatchObject({ batch: 0, refunds: ["2026-10-27", "2026-10-27"] });
    expect(await budget.reserve(sender())).not.toBeNull();
    expect(await budget.reserve(sender())).toBeNull(); // 1 failed + 1 = the cap of 2
  });

  it("defers everything once the budget is used up, with one log line", async () => {
    const { c, counter } = fakeCounter(0);
    const budget = createBatchBudget({ runCap: 50, dailyLimit: 60, counter });
    expect(await budget.reserve(sender())).toBeNull();
    expect(await budget.reserve(sender())).toBeNull();
    expect(c.reserves).toBe(1); // stopped: no more counter round-trips this run
    expect(output()).toEqual([
      "[email-batch] email budget used up (batch 60/day, all 70/day, 2700/month, UTC); the rest waits",
    ]);
  });

  it("clamps a larger daily budget to 60", async () => {
    const { counter } = fakeCounter(0);
    const asked: number[] = [];
    const budget = createBatchBudget({
      dailyLimit: 95,
      counter: { ...counter, reserve: async (n) => (asked.push(n), null) },
    });
    expect(await budget.reserve(sender())).toBeNull();
    expect(asked).toEqual([60]);
    expect(output()).toEqual([
      "[email-batch] email budget used up (batch 60/day, all 70/day, 2700/month, UTC); the rest waits",
    ]);
  });

  it("stops the whole batch on a 429, refunds that send on its own day, and logs once", async () => {
    const { c, counter } = fakeCounter(100);
    const budget = createBatchBudget({ runCap: 50, counter });
    const send = sender({ ok: false, reason: "rate_limited" });
    const slot = (await budget.reserve(send))!;
    expect(await slot.send(mail())).toEqual({ ok: false, reason: "rate_limited" });
    expect(slot.rateLimited).toBe(true);
    await slot.release();
    expect(await budget.reserve(send)).toBeNull();
    expect(await budget.reserve(send)).toBeNull();
    expect(send.calls).toBe(1);
    expect(c).toMatchObject({ batch: 0, refunds: ["2026-10-27"] });
    expect(output()).toEqual([
      "[email-batch] rate limited by email provider; stopping batch sends this run",
    ]);
  });

  it("stops after 3 failed sends in a row (a success in between resets the streak)", async () => {
    const { c, counter } = fakeCounter(100);
    const budget = createBatchBudget({ runCap: 50, counter });
    const failed: SendResult = { ok: false, reason: "send_failed" };
    const send = sender(failed, failed, { ok: true }, failed, failed, failed, { ok: true });
    let slots = 0;
    for (let slot = await budget.reserve(send); slot; slot = await budget.reserve(send)) {
      slots++;
      await slot.send(mail());
      await slot.release();
    }
    expect(slots).toBe(6);
    expect(send.calls).toBe(6);
    expect(c).toMatchObject({ batch: 1, refunds: Array(5).fill("2026-10-27") });
    expect(output()).toEqual([
      "[email-batch] 3 sends failed in a row; stopping batch sends this run",
    ]);
  });

  it("refunds on the day it charged, even after the UTC day has turned", async () => {
    const { c, counter } = fakeCounter(100, "2026-10-27");
    const budget = createBatchBudget({ counter });
    const slot = (await budget.reserve(sender()))!;
    counter.reserve = async () => "2026-10-28"; // midnight UTC passes mid-run
    await slot.release();
    expect(c.refunds).toEqual(["2026-10-27"]);
  });

  it("touches nothing until the first reservation", () => {
    const db = new Proxy({}, { get: () => () => expect.fail("db used") }) as Executor;
    createBatchBudget({ db });
  });
});

describe("sendCounter (SQL)", () => {
  function recordingDb(rows: unknown[] = [], rowCount = 0) {
    const queries: { sql: string; params: unknown[]; tx: boolean }[] = [];
    const exec = (tx: boolean) => async (q: SQL) => (
      queries.push({ ...dialect.sqlToQuery(q), tx }),
      { rows, rowCount }
    );
    const db = {
      execute: exec(false),
      transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ execute: exec(true) }),
    } as unknown as Executor;
    return { db, queries };
  }

  it("reserves under the advisory lock, then in one conditional upsert keyed by the database's UTC day", async () => {
    const { db, queries } = recordingDb([{ period: "2026-10-27" }]);
    expect(await sendCounter(db).reserve(60)).toBe("2026-10-27");
    expect(queries).toHaveLength(2);
    expect(queries.every((q) => q.tx)).toBe(true);
    expect(queries[0].sql).toBe("select pg_advisory_xact_lock($1::bigint)");
    expect(queries[0].params).toEqual([SEND_COUNTER_LOCK]);
    const { sql, params } = queries[1];
    const flat = sql.replace(/\s+/g, " ");
    expect(flat).toContain("insert into email_send_counters (period, batch, total)");
    expect(flat).toContain("to_char(now() at time zone 'UTC', 'YYYY-MM-DD')");
    expect(flat).toContain("on conflict (period) do update set");
    expect(flat).toMatch(/where email_send_counters\.batch < \$\d+::integer/);
    expect(flat).toMatch(/and email_send_counters\.total < \$\d+/);
    expect(flat).toContain("to_char(now() at time zone 'UTC', 'YYYY-MM')");
    // The month: earlier days from the snapshot, today from the locked row.
    expect(flat).toContain("+ email_send_counters.total <");
    expect(flat).toContain("returning period");
    expect(params).toEqual(
      expect.arrayContaining([60, BATCH_DAILY_TOTAL_LIMIT, BATCH_MONTHLY_TOTAL_LIMIT]),
    );
  });

  it("clamps the daily budget to 60", async () => {
    const { db, queries } = recordingDb();
    await sendCounter(db).reserve(95);
    expect(queries[1].params).not.toContain(95);
    expect(queries[1].params).toContain(60);
  });

  it("returns null when the statement charged nothing", async () => {
    const { db } = recordingDb([]);
    expect(await sendCounter(db).reserve(60)).toBeNull();
  });

  it("refunds the given period only, floored at 0", async () => {
    const { db, queries } = recordingDb();
    await sendCounter(db).refund("2026-10-27");
    const flat = queries[0].sql.replace(/\s+/g, " ");
    expect(flat).toContain("batch = greatest(batch - 1, 0)");
    expect(flat).toContain("total = greatest(total - 1, 0)");
    expect(flat).toMatch(/where period = \$1$/);
    expect(queries[0].params).toEqual(["2026-10-27"]);
    expect(flat).not.toContain("now() at time zone");
  });

  it("counts transactional sends into today's total by the database clock", async () => {
    const { db, queries } = recordingDb();
    await countSent(3, db);
    const flat = queries[0].sql.replace(/\s+/g, " ");
    expect(flat).toContain("to_char(now() at time zone 'UTC', 'YYYY-MM-DD')");
    expect(flat).toContain("total = email_send_counters.total + excluded.total");
    expect(flat).not.toContain("batch");
    expect(flat).not.toContain("lock");
    expect(queries[0].params).toEqual([3]);
  });

  it("prunes counter rows of UTC days more than 90 days ago, comparing the period as text", async () => {
    const { db, queries } = recordingDb([], 4);
    expect(await pruneSendCounters(db)).toBe(4);
    const flat = queries[0].sql.replace(/\s+/g, " ").trim();
    expect(flat).toBe(
      "delete from email_send_counters where period < to_char((now() at time zone 'UTC') - $1::integer * interval '1 day', 'YYYY-MM-DD')",
    );
    expect(queries[0].params).toEqual([90]);
  });
});

describe("transactional mail", () => {
  const TRANSACTIONAL = [
    "password-reset",
    "lead-notice",
    "lead-copy",
    "lead-assignment",
    "sync-alert",
  ] as const;

  beforeEach(() => {
    h.env.RESEND_API_KEY = "re_test_key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 200 })),
    );
  });

  it("is sent while the batch budget is used up, and counted per recipient", async () => {
    const { c, counter } = fakeCounter(0);
    const budget = createBatchBudget({ counter });
    expect(await budget.reserve(sendEmail)).toBeNull();

    for (const kind of TRANSACTIONAL) expect(await sendEmail(mail(kind))).toEqual({ ok: true });
    expect(await sendEmail(mail("lead-copy", ["a@one.example", "b@two.example"]))).toEqual({
      ok: true,
    });
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(c.reserves).toBe(1);
    expect(h.queries.map((q) => q.params)).toEqual([[1], [1], [1], [1], [1], [2]]);
  });

  it("doesn't count batch mail again: the reservation already did", async () => {
    for (const kind of ["search-alert", "saved-home-digest", "lead-digest"] as const)
      expect(await sendEmail(mail(kind))).toEqual({ ok: true });
    expect(h.queries).toEqual([]);
  });

  it("isn't counted when it didn't go", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 500 })),
    );
    await sendEmail(mail("password-reset"));
    expect(h.queries).toEqual([]);
  });

  it("still reports sent when counting fails, logging no address", async () => {
    h.fail = true;
    expect(await sendEmail(mail("lead-notice"))).toEqual({ ok: true });
    expect(output()).toEqual([
      "[email] kind=lead-notice to_domain=example.com status=sent",
      "[email-batch] could not count a sent email (kind=lead-notice)",
    ]);
  });
});

describe("activateEmailAlerts", () => {
  /** app_flags and the two backlog updates, in memory. */
  function flagDb() {
    const state = { flag: false, updates: [] as string[] };
    const execute = async (q: SQL) => {
      const { sql } = dialect.sqlToQuery(q);
      if (sql.includes("select 1 from app_flags")) return { rows: state.flag ? [{}] : [] };
      if (sql.includes("insert into app_flags")) {
        if (state.flag) return { rows: [] };
        state.flag = true;
        return { rows: [{ key: "email_alerts_activated" }] };
      }
      state.updates.push(sql.replace(/\s+/g, " ").trim());
      return { rows: [] };
    };
    const db = {
      execute,
      transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn({ execute }),
    } as unknown as Executor;
    return { db, state };
  }

  it("marks older changes as seen once, by the database clock; a second call is a no-op", async () => {
    const { db, state } = flagDb();
    expect(await activateEmailAlerts(db)).toBe(true);
    expect(state.updates).toEqual([
      "update saved_searches set last_alerted_at = greatest(coalesce(last_alerted_at, created_at), now() - interval '24 hours')",
      "update saved_listings set last_notified_at = greatest(coalesce(last_notified_at, created_at), now() - interval '24 hours')",
    ]);
    expect(await activateEmailAlerts(db)).toBe(false);
    expect(state.updates).toHaveLength(2);
  });

  it("applies once when two runs race past the first check", async () => {
    const { db, state } = flagDb();
    const results = await Promise.all([activateEmailAlerts(db), activateEmailAlerts(db)]);
    expect(results.sort()).toEqual([false, true]);
    expect(state.updates).toHaveLength(2);
  });
});
