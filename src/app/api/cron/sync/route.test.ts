import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceSyncOutcome, SyncResult } from "@/lib/mls/sync";

// The cron route with the sync itself mocked: how it maps its parameters, when
// it refreshes the page caches, and what it answers.

const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  outcomes: [] as SourceSyncOutcome[],
  tags: [] as Array<[string, unknown]>,
  digests: [] as Array<Record<string, unknown>>,
  configured: false,
  prunes: 0,
  pruneFails: false,
  outboxRuns: 0,
  outboxFails: false,
  backfills: [] as Array<Record<string, unknown>>,
  backfillFails: false,
  order: [] as string[],
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/search/keyword-backfill", () => ({
  backfillKeywordTsv: async (_db: unknown, opts: Record<string, unknown>) => {
    h.backfills.push(opts);
    h.order.push("backfill");
    if (h.backfillFails) throw new Error("connection terminated");
    return 7;
  },
}));
vi.mock("@/lib/leads/outbox", () => ({
  retryLeadEmails: async () => {
    h.outboxRuns++;
    if (h.outboxFails) throw new Error("relation email_outbox does not exist");
    return { sent: 0, retry: 0, dead: 0, gone: 0 };
  },
}));
vi.mock("@/lib/email", () => ({ emailConfigured: () => h.configured }));
vi.mock("@/lib/email-batch", () => ({
  pruneSendCounters: async () => {
    h.prunes++;
    if (h.pruneFails) throw new Error("connection terminated");
    return 0;
  },
}));

vi.mock("@/lib/cron-auth", () => ({
  isCronAuthorized: (r: Request) => r.headers.get("authorization") === "Bearer secret",
}));
vi.mock("@/lib/mls/sync", () => ({
  syncAllSources: async (opts: Record<string, unknown>) => {
    h.calls.push(opts);
    h.order.push("sync");
    return h.outcomes;
  },
}));
vi.mock("@/lib/leads/digest", () => ({
  runLeadDigests: async (opts: Record<string, unknown>) => {
    h.digests.push(opts);
    return { ok: true, emailed: 0 };
  },
}));
vi.mock("next/cache", () => ({
  revalidateTag: (tag: string, profile: unknown) => h.tags.push([tag, profile]),
}));

const { GET, maxDuration } = await import("./route");
const { LISTINGS_TAG } = await import("@/lib/listings/cache-tags");

const result = (over: Partial<SyncResult> = {}): SyncResult => ({
  fetched: 0,
  upserted: 0,
  unchanged: 0,
  removed: 0,
  runId: "r1",
  mode: "incremental",
  status: "succeeded",
  skipped: {},
  cursor: null,
  mediaRowsWritten: 0,
  nulled: 0,
  quarantined: 0,
  pruned: 0,
  staleRunsFailed: 0,
  changed: false,
  ...over,
});

const call = (query = "", auth = "Bearer secret") =>
  GET(
    new NextRequest(`http://localhost/api/cron/sync${query}`, {
      headers: { authorization: auth },
    }),
  );

beforeEach(() => {
  h.calls.length = 0;
  h.tags.length = 0;
  h.digests.length = 0;
  h.prunes = 0;
  h.pruneFails = false;
  h.outboxRuns = 0;
  h.outboxFails = false;
  h.configured = false;
  h.backfills.length = 0;
  h.backfillFails = false;
  h.order.length = 0;
  h.outcomes = [{ source: "gamls", ok: true, result: result() }];
});

describe("GET /api/cron/sync", () => {
  it("refuses a caller without the cron secret, and syncs nothing", async () => {
    const res = await call("", "Bearer wrong");
    expect(res.status).toBe(401);
    expect(h.calls).toHaveLength(0);
  });

  it("runs an incremental sync with a deadline that leaves 45 s of the function's limit", async () => {
    const before = Date.now();
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ mode: "incremental", allowLargePurge: false });
    const deadline = h.calls[0].deadline as number;
    expect(deadline).toBeGreaterThanOrEqual(before + (maxDuration - 45) * 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + (maxDuration - 45) * 1000);
  });

  it("?purge=1 is a purge; the large-purge override needs its own flag", async () => {
    await call("?purge=1");
    expect(h.calls[0]).toMatchObject({ mode: "purge", allowLargePurge: false });
    await call("?purge=1&allowLargePurge=1");
    expect(h.calls[1]).toMatchObject({ mode: "purge", allowLargePurge: true });
  });

  it("prunes old email send counters on the daily purge only", async () => {
    await call();
    expect(h.prunes).toBe(0);
    expect((await call("?purge=1")).status).toBe(200);
    expect(h.prunes).toBe(1);
  });

  it("logs one line when the counter prune fails, and still purges", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    h.pruneFails = true;
    const res = await call("?purge=1");
    expect(res.status).toBe(200);
    expect(h.calls[0]).toMatchObject({ mode: "purge" });
    expect(errors.mock.calls).toEqual([
      [expect.stringMatching(/^\[cron\] email counter prune failed: /)],
    ]);
    errors.mockRestore();
  });

  it("retries queued lead notices on every run once email is configured", async () => {
    await call();
    expect(h.outboxRuns).toBe(0);
    h.configured = true;
    await call();
    await call("?purge=1");
    expect(h.outboxRuns).toBe(2);
  });

  it("logs one line when the outbox fails, and still answers for the sync alone", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    h.configured = true;
    h.outboxFails = true;
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.digests).toHaveLength(1);
    expect(errors.mock.calls).toEqual([[expect.stringMatching(/^\[cron\] email outbox failed: /)]]);
    errors.mockRestore();
  });

  it("refreshes the listing caches when a source changed listings", async () => {
    h.outcomes = [
      { source: "a", ok: true, result: result() },
      { source: "b", ok: true, result: result({ removed: 3, changed: true }) },
    ];
    await call("?purge=1");
    expect(h.tags).toEqual([[LISTINGS_TAG, "max"]]);
  });

  it("leaves the caches alone when nothing changed", async () => {
    await call();
    expect(h.tags).toEqual([]);
  });

  it("answers 500 when a source failed, and still refreshes the pages it wrote first", async () => {
    h.outcomes = [{ source: "a", ok: false, error: "RESO request failed (503)", changed: true }];
    const res = await call();
    expect(res.status).toBe(500);
    expect(h.tags).toEqual([[LISTINGS_TAG, "max"]]);
    expect(await res.json()).toMatchObject({ results: [{ ok: false }] });
  });

  it("tries the morning summary after the sync, within the function's limit, and reports it", async () => {
    const before = Date.now();
    const res = await call("?purge=1");
    expect(h.digests).toHaveLength(1);
    const deadline = h.digests[0].deadline as number;
    expect(deadline).toBeGreaterThanOrEqual(before + (maxDuration - 15) * 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + (maxDuration - 15) * 1000);
    expect(await res.json()).toMatchObject({ digests: { ok: true } });
  });

  it("fills missing keyword vectors after the sync, within the sync's budget, and logs how many", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const before = Date.now();
    for (const query of ["", "?purge=1"]) expect((await call(query)).status).toBe(200);
    expect(h.order).toEqual(["sync", "backfill", "sync", "backfill"]);
    const deadline = h.backfills[0].deadline as number;
    expect(deadline).toBeGreaterThanOrEqual(before + (maxDuration - 45) * 1000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + (maxDuration - 45) * 1000);
    expect(info.mock.calls).toContainEqual(["[cron] keyword search: filled 7 listings"]);
    info.mockRestore();
  });

  it("logs one line when the keyword backfill fails, and still answers for the sync", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    h.backfillFails = true;
    const res = await call();
    expect(res.status).toBe(200);
    expect(errors.mock.calls).toEqual([
      [expect.stringMatching(/^\[cron\] keyword backfill failed: /)],
    ]);
    errors.mockRestore();
  });

  it("reports whether email is configured, as a boolean only", async () => {
    h.configured = false;
    expect((await (await call()).json()).email).toEqual({ configured: false });
    h.configured = true;
    expect((await (await call()).json()).email).toEqual({ configured: true });
  });

  it("answers 200 for a skipped incremental sync (recorded; the next run carries on)", async () => {
    h.outcomes = [{ source: "a", ok: true, result: result({ status: "skipped", runId: null }) }];
    const res = await call();
    expect(res.status).toBe(200);
  });

  it("answers 200 for a source skipped for missing credentials, and says why", async () => {
    h.outcomes = [
      {
        source: "gamls",
        ok: true,
        note: "MLS_GAMLS_TOKEN is not set",
        result: result({ status: "skipped", runId: null }),
      },
    ];
    const res = await call();
    expect(res.status).toBe(200);
    expect(h.tags).toEqual([]);
    const body = await res.json();
    expect(body.results[0].note).toBeDefined();
  });
});
