import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import type { Email, SendEmail, SendResult } from "@/lib/email";
import { captureConsole } from "@/test/console";

const h = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  Object.assign(h.env, mod.env, { RESEND_API_KEY: undefined });
  return { ...mod, env: h.env };
});

const { createBatchBudget, dailyCounter } = await import("./email-batch");
const { sendEmail } = await import("./email");

let output: () => string[];
beforeEach(() => {
  ({ output } = captureConsole());
  h.env.RESEND_API_KEY = undefined;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const mail = (kind: Email["kind"] = "search-alert"): Email => ({
  kind,
  to: "pat.buyer@example.com",
  subject: "3 new homes for Lake Hartwell",
  text: "body",
});

/** An in-memory daily counter with `limit` sends left. */
function fakeDaily(limit: number) {
  const c = { count: 0, takes: 0, refunds: 0 };
  return {
    c,
    daily: {
      take: async () => {
        c.takes++;
        if (c.count >= limit) return false;
        c.count++;
        return true;
      },
      refund: async () => {
        c.refunds++;
        c.count--;
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
    const { c, daily } = fakeDaily(100);
    const budget = createBatchBudget({ runCap: 2, daily });
    const send = sender();
    for (let i = 0; i < 2; i++) {
      const slot = (await budget.reserve(send))!;
      expect((await slot.send(mail())).ok).toBe(true);
      await slot.release();
    }
    expect(await budget.reserve(send)).toBeNull();
    expect(await budget.reserve(send)).toBeNull();
    expect(c).toMatchObject({ count: 2, takes: 2, refunds: 0 });
    expect(output()).toEqual([
      "[email-batch] per-run cap (2) reached; the rest waits for the next run",
    ]);
  });

  it("refunds a reservation whose email didn't go, so it doesn't count", async () => {
    const { c, daily } = fakeDaily(100);
    const budget = createBatchBudget({ runCap: 1, daily });
    // Claimed elsewhere / nothing to say: no send at all.
    await (await budget.reserve(sender()))!.release();
    // A failed send (not a 429).
    const failing = (await budget.reserve(sender({ ok: false, reason: "send_failed" })))!;
    await failing.send(mail());
    await failing.release();
    await failing.release(); // a second release is a no-op
    expect(c).toMatchObject({ count: 0, refunds: 2 });
    // The cap of 1 is still free.
    expect(await budget.reserve(sender())).not.toBeNull();
  });

  it("defers everything once the daily budget is used up, with one log line", async () => {
    const { c, daily } = fakeDaily(0);
    const budget = createBatchBudget({ runCap: 50, dailyLimit: 60, daily });
    expect(await budget.reserve(sender())).toBeNull();
    expect(await budget.reserve(sender())).toBeNull();
    expect(c.takes).toBe(1); // stopped: no more counter round-trips this run
    expect(output()).toEqual([
      "[email-batch] daily budget (60) used up; the rest waits for tomorrow (UTC)",
    ]);
  });

  it("stops the whole batch on a 429, refunds that send, and logs once", async () => {
    const { c, daily } = fakeDaily(100);
    const budget = createBatchBudget({ runCap: 50, daily });
    const send = sender({ ok: false, reason: "rate_limited" });
    const slot = (await budget.reserve(send))!;
    expect(await slot.send(mail())).toEqual({ ok: false, reason: "rate_limited" });
    await slot.release();
    expect(await budget.reserve(send)).toBeNull();
    expect(await budget.reserve(send)).toBeNull();
    expect(send.calls).toBe(1);
    expect(c).toMatchObject({ count: 0, refunds: 1 });
    expect(output()).toEqual([
      "[email-batch] rate limited by email provider; stopping batch sends this run",
    ]);
  });

  it("touches nothing until the first reservation", () => {
    const db = new Proxy({}, { get: () => () => expect.fail("db used") }) as Executor;
    createBatchBudget({ db });
  });
});

describe("transactional mail", () => {
  it("is sent while the batch budget is used up, and isn't counted", async () => {
    h.env.RESEND_API_KEY = "re_test_key";
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const { c, daily } = fakeDaily(0);
    const budget = createBatchBudget({ daily });
    expect(await budget.reserve(sendEmail)).toBeNull();

    for (const kind of [
      "password-reset",
      "lead-notice",
      "lead-copy",
      "lead-assignment",
      "sync-alert",
    ] as const)
      expect(await sendEmail(mail(kind))).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(5);
    expect(c.takes).toBe(1);
  });
});

describe("dailyCounter", () => {
  /** `rate_limits` in memory, as hitRateLimits / refundRateLimits use it. */
  function fakeRateLimitsDb() {
    const rows = new Map<string, { windowStart: Date; count: number }>();
    const db = {
      insert: () => ({
        values: (vals: { key: string; windowStart: Date; count: number }[]) => ({
          onConflictDoUpdate: () => ({
            returning: async () =>
              vals.map((v) => {
                const row = rows.get(v.key);
                const next =
                  row && row.windowStart.getTime() === v.windowStart.getTime()
                    ? { ...row, count: row.count + v.count }
                    : { windowStart: v.windowStart, count: v.count };
                rows.set(v.key, next);
                return { key: v.key, count: next.count };
              }),
          }),
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => {
            for (const row of rows.values()) row.count = Math.max(row.count - 1, 0);
          },
        }),
      }),
    };
    return { db: db as unknown as Executor, rows };
  }

  it("counts per UTC day in rate_limits and gives back a refused or unused send", async () => {
    const { db, rows } = fakeRateLimitsDb();
    const now = new Date("2026-10-27T15:30:00Z");
    const counter = dailyCounter(db, 2, now);
    expect(await counter.take()).toBe(true);
    expect(await counter.take()).toBe(true);
    expect(await counter.take()).toBe(false); // over: refunded straight away
    expect(rows.get("email-batch:1d:resend")).toEqual({
      windowStart: new Date("2026-10-27T00:00:00Z"),
      count: 2,
    });
    await counter.refund();
    expect(rows.get("email-batch:1d:resend")!.count).toBe(1);
  });
});
