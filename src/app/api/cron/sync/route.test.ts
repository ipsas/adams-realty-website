import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceSyncOutcome, SyncResult } from "@/lib/mls/sync";

// The cron route with the sync itself mocked: how it maps its parameters, when
// it refreshes the page caches, and what it answers.

const h = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  outcomes: [] as SourceSyncOutcome[],
  tags: [] as Array<[string, unknown]>,
}));

vi.mock("@/lib/cron-auth", () => ({
  isCronAuthorized: (r: Request) => r.headers.get("authorization") === "Bearer secret",
}));
vi.mock("@/lib/mls/sync", () => ({
  syncAllSources: async (opts: Record<string, unknown>) => {
    h.calls.push(opts);
    return h.outcomes;
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

  it("answers 200 for a skipped incremental sync (recorded; the next run carries on)", async () => {
    h.outcomes = [{ source: "a", ok: true, result: result({ status: "skipped", runId: null }) }];
    const res = await call();
    expect(res.status).toBe(200);
  });
});
