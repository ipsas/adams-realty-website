import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Executor } from "@/db";
import type { SendResult } from "@/lib/email";
import { createBatchBudget } from "@/lib/email-batch";
import { captureConsole } from "@/test/console";
import { runAlerts } from "./run";
import { localClock } from "./schedule";

const h = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
  homeCandidates: [] as { userId: string; listingId: string; email: string; since: Date }[],
  homeClaims: [] as string[],
  homeReleases: [] as string[],
}));

vi.mock("@/lib/env", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/env")>();
  Object.assign(h.env, mod.env, { RESEND_API_KEY: undefined });
  return { ...mod, env: h.env };
});
// Everything past the claim is faked: these tests are about what gets claimed and sent.
vi.mock("./queries", () => ({
  findSearchMatches: async () => ({
    newTotal: 1,
    cutTotal: 0,
    newRows: [{ sourceId: "gamls" }],
    cutRows: [],
  }),
  disclaimersFor: async () => [],
}));
vi.mock("./homes", () => ({
  findHomeCandidates: async () => h.homeCandidates,
  claimHomes: async (_db: unknown, userId: string, listingIds: string[]) => {
    h.homeClaims.push(userId);
    return listingIds.map((listingId) => ({ listingId, createdAt: new Date(0), previous: null }));
  },
  releaseHomes: async (_db: unknown, userId: string) => void h.homeReleases.push(userId),
  loadHomeChanges: async () => [{ listing: { sourceId: "gamls" }, events: [] }],
}));
vi.mock("./present", () => ({
  allocateRows: (n: number, c: number) => ({ newShown: n, cutsShown: c }),
  priceCutDetails: () => ({}),
  summarizeHomeEvents: () => ({}),
  toEmailListing: () => ({}),
}));
vi.mock("./token", () => ({
  HOME_ALERTS_SCOPE: "homes",
  unsubscribeUrls: () => ({
    page: "https://adams.example/u/tok_PAGE",
    oneClick: "https://adams.example/u/tok_ONE",
  }),
}));
vi.mock("@/lib/mls/last-updated", () => ({ gamlsLastSyncedAt: async () => null }));
vi.mock("@/lib/email-templates", () => ({
  absoluteUrl: (p: string) => `https://adams.example${p}`,
  savedSearchAlertEmail: () => ({
    subject: "SUBJECT New homes for Pat",
    text: "BODY tok_PAGE",
    html: "<p>BODY</p>",
  }),
  savedHomesUpdateEmail: () => ({ subject: "SUBJECT homes", text: "BODY", html: "<p>BODY</p>" }),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  h.env.RESEND_API_KEY = undefined;
  h.homeCandidates = [];
  h.homeClaims = [];
  h.homeReleases = [];
});

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

const NOW = new Date("2026-09-30T12:00:00Z");
const dialect = new PgDialect();

/**
 * Due instant searches s1…sN, and `execute` that records which ones get
 * claimed (last_alerted_at advanced) and released.
 */
function searchDb(n: number) {
  const searches = Array.from({ length: n }, (_, i) => ({
    id: `s${i + 1}`,
    userId: `u${i + 1}`,
    name: `Search ${i + 1}`,
    criteria: {},
    alertFrequency: "instant",
    lastAlertedAt: new Date(NOW.getTime() - 3_600_000),
    createdAt: new Date("2026-09-01T00:00:00Z"),
    email: `pat${i + 1}@example.com`,
  }));
  const claimed: string[] = [];
  const released: string[] = [];
  const chain = { from: () => chain, innerJoin: () => chain, where: async () => searches };
  const db = {
    select: () => chain,
    execute: async (q: SQL) => {
      const { sql, params } = dialect.sqlToQuery(q);
      const id = params.find((p) => typeof p === "string" && /^s\d+$/.test(p)) as string;
      if (sql.includes("from (select")) {
        claimed.push(id);
        return { rows: [{ previous: searches.find((s) => s.id === id)!.lastAlertedAt }] };
      }
      released.push(id);
      return { rows: [] };
    },
  };
  return { db: db as unknown as Executor, claimed, released };
}

const unlimitedCounter = () => ({ reserve: async () => "2026-09-30", refund: async () => {} });
const home = (userId: string, listingId: string, since = new Date(NOW.getTime() - 60_000)) => ({
  userId,
  listingId,
  email: `${userId}@example.com`,
  since,
});

describe("alert run with no Resend key", () => {
  it("claims nothing (no last_alerted_at or last_notified_at advanced) and says it skipped", async () => {
    const { output } = captureConsole();
    const { db, used } = untouchedDb();
    const res = await runAlerts({ db, now: NOW });
    expect(res).toMatchObject({
      ok: true,
      skipped: "email-not-configured",
      searches: { due: 0, emailed: 0, failed: 0 },
      homes: { users: 0, emailed: 0, failed: 0 },
    });
    expect(used).toEqual([]);
    expect(output()).toEqual(["[alerts] skipped: email not configured"]);
  });
});

describe("alert run under the batch-mail guard", () => {
  it("stops at the per-run cap and leaves the rest unclaimed and due", async () => {
    captureConsole();
    const { db, claimed, released } = searchDb(5);
    h.homeCandidates = [home("h1", "l1")];
    const send = vi.fn(async (): Promise<SendResult> => ({ ok: true }));
    const budget = createBatchBudget({ runCap: 3, counter: unlimitedCounter() });
    const res = await runAlerts({ db, now: NOW, send, budget });
    expect(claimed).toEqual(["s1", "s2", "s3"]);
    expect(released).toEqual([]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(res.searches).toMatchObject({ due: 5, emailed: 3, deferred: 2, failed: 0 });
    // The cap is per run, across searches and saved homes.
    expect(h.homeClaims).toEqual([]);
    expect(res.homes).toMatchObject({ users: 1, emailed: 0, deferred: 1 });
    expect(res.ok).toBe(true);
  });

  it("defers every item, claiming none, when the budget is used up", async () => {
    const { output } = captureConsole();
    const { db, claimed } = searchDb(3);
    h.homeCandidates = [home("h1", "l1")];
    const send = vi.fn(async (): Promise<SendResult> => ({ ok: true }));
    const budget = createBatchBudget({
      dailyLimit: 60,
      counter: { reserve: async () => null, refund: async () => {} },
    });
    const res = await runAlerts({ db, now: NOW, send, budget });
    expect(claimed).toEqual([]);
    expect(h.homeClaims).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(res.searches).toMatchObject({ due: 3, deferred: 3, emailed: 0 });
    expect(res.homes).toMatchObject({ deferred: 1 });
    expect(output().filter((l) => l.startsWith("[email-batch]"))).toEqual([
      "[email-batch] email budget used up (batch 60/day, all 85/day, 2700/month, UTC); the rest waits",
    ]);
  });

  it("defers on a 429: releases that claim, leaves the rest unclaimed, stays ok, logs once", async () => {
    const { output } = captureConsole();
    h.env.RESEND_API_KEY = "re_test_key";
    const fetch = vi.fn(
      async () => new Response('{"message":"rate limit for pat1@example.com"}', { status: 429 }),
    );
    vi.stubGlobal("fetch", fetch);
    const { db, claimed, released } = searchDb(3);
    // Saved after the searches last ran, so they come after them.
    h.homeCandidates = [home("h1", "l1"), home("h2", "l2")];
    const refunds = vi.fn<(period: string) => Promise<void>>(async () => {});
    const budget = createBatchBudget({
      runCap: 50,
      counter: { reserve: async () => "2026-09-30", refund: refunds },
    });
    // No `send`: the real sendEmail, against a Resend that answers 429.
    const res = await runAlerts({ db, now: NOW, budget });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(claimed).toEqual(["s1"]);
    expect(released).toEqual(["s1"]); // last_alerted_at given back: retried next run
    expect(refunds.mock.calls).toEqual([["2026-09-30"]]);
    // A planned deferral, not a failure: the cron answers 200.
    expect(res.searches).toMatchObject({ due: 3, failed: 0, deferred: 3, emailed: 0 });
    expect(h.homeClaims).toEqual([]);
    expect(res.homes).toMatchObject({ users: 2, deferred: 2, emailed: 0 });
    expect(res).toMatchObject({ ok: true, rate_limited: true, deferred: 5 });

    const lines = output();
    expect(lines.filter((l) => l.startsWith("[email]"))).toEqual([
      "[email] kind=search-alert to_domain=example.com status=failed http=429",
    ]);
    expect(lines.filter((l) => l.includes("rate limited by email provider"))).toEqual([
      "[email-batch] rate limited by email provider; stopping batch sends this run",
    ]);
    const all = lines.join("\n");
    for (const secret of ["pat1", "SUBJECT", "BODY", "tok_PAGE", "tok_ONE", "rate limit for"])
      expect(all).not.toContain(secret);
  });

  it("counts non-429 failures as failed, and they use their run-cap place", async () => {
    captureConsole();
    const { db, claimed, released } = searchDb(4);
    const send = vi.fn(async (): Promise<SendResult> => ({ ok: false, reason: "send_failed" }));
    const budget = createBatchBudget({ runCap: 2, counter: unlimitedCounter() });
    const res = await runAlerts({ db, now: NOW, send, budget });
    expect(claimed).toEqual(["s1", "s2"]);
    expect(released).toEqual(["s1", "s2"]);
    expect(res.searches).toMatchObject({ failed: 2, deferred: 2 });
    expect(res.ok).toBe(false);
    expect(res.rate_limited).toBeUndefined();
  });
});

describe("alert run order", () => {
  it("puts saved searches and saved-home digests in one list, oldest first", async () => {
    captureConsole();
    const { db, claimed } = searchDb(3); // last alerted an hour ago
    h.homeCandidates = [
      home("h2", "l2", new Date(NOW.getTime() - 30 * 60_000)),
      home("h1", "l1", new Date(NOW.getTime() - 2 * 3_600_000)),
      home("h1", "l3", new Date(NOW.getTime() - 10 * 60_000)),
    ];
    const order: string[] = [];
    const send = vi.fn(async (e: { to: string | string[] }): Promise<SendResult> => {
      order.push(String(e.to).split("@")[0]);
      return { ok: true };
    });
    const res = await runAlerts({
      db,
      now: NOW,
      send,
      budget: createBatchBudget({ runCap: 4, counter: unlimitedCounter() }),
    });
    // h1 keyed by its oldest home (2 h), the searches tie at 1 h (by id), h2 at 30 min.
    expect(order).toEqual(["h1", "pat1", "pat2", "pat3"]);
    expect(claimed).toEqual(["s1", "s2", "s3"]);
    expect(res.homes).toMatchObject({ users: 2, emailed: 1, deferred: 1 });
  });

  it("emails every one of 200 stale daily searches within a week on 60 a day, never twice a day", async () => {
    captureConsole();
    const DAY = 86_400_000;
    const HOUR = 3_600_000;
    const start = new Date("2026-10-28T11:00:05Z"); // Wed 7:00:05 a.m. EDT
    const searches = Array.from({ length: 200 }, (_, i) => ({
      id: `s${i + 1}`,
      userId: `u${i + 1}`,
      name: `Search ${i + 1}`,
      criteria: {},
      alertFrequency: "daily",
      lastAlertedAt: new Date(start.getTime() - 10 * DAY) as Date | null,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      email: `p${i + 1}@example.com`,
    }));
    // saved_searches with claimSearch / releaseSearch semantics.
    const chain = {
      from: () => chain,
      innerJoin: () => chain,
      where: async () => searches.map((s) => ({ ...s })),
    };
    const db = {
      select: () => chain,
      execute: async (q: SQL) => {
        const { sql, params } = dialect.sqlToQuery(q);
        const row = searches.find((s) => params.includes(s.id))!;
        const stamps = params.filter(
          (p): p is string => typeof p === "string" && /^\d{4}-/.test(p),
        );
        if (sql.includes("from (select")) {
          const [nowIso, leaseIso] = stamps;
          if (row.lastAlertedAt && !(row.lastAlertedAt < new Date(leaseIso))) return { rows: [] };
          const previous = row.lastAlertedAt;
          row.lastAlertedAt = new Date(nowIso);
          return { rows: [{ previous }] };
        }
        return { rows: [] };
      },
    } as unknown as Executor;

    // email_send_counters in memory: batch per UTC day of the simulated clock.
    let now = start;
    const perDay = new Map<string, number>();
    const counter = {
      reserve: async (budget: number) => {
        const day = now.toISOString().slice(0, 10);
        if ((perDay.get(day) ?? 0) >= budget) return null;
        perDay.set(day, (perDay.get(day) ?? 0) + 1);
        return day;
      },
      refund: async (day: string) => void perDay.set(day, Math.max((perDay.get(day) ?? 0) - 1, 0)),
    };

    const sends: { to: string; localDay: string }[] = [];
    for (let i = 0; i < 7 * 24; i++) {
      now = new Date(start.getTime() + i * HOUR);
      const at = now;
      const send = async (e: { to: string | string[] }): Promise<SendResult> => {
        sends.push({ to: String(e.to), localDay: localClock(at).date });
        return { ok: true };
      };
      const budget = createBatchBudget({ runCap: 50, dailyLimit: 60, counter });
      await runAlerts({ db, now, send, budget });
    }

    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(60);
    const emailed = new Set(sends.map((s) => s.to));
    expect(searches.filter((s) => !emailed.has(s.email))).toEqual([]);
    const sameDay = new Set(sends.map((s) => `${s.to}|${s.localDay}`));
    expect(sends.length - sameDay.size).toBe(0);
  }, 30_000);
});
