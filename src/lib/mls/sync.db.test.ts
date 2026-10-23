import { asc, eq, sql } from "drizzle-orm";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { agents, dataSources, listings, syncRuns } from "@/db/schema";
import { closeDb, createSource, listing, resetDb } from "@/test/db/helpers";
import { STALE_RUN_MS } from "./sync-engine";
import { createSyncStore, STALE_RUN_ERROR } from "./sync-store";
import { FEED_GRACE_MS, SyncFailedError, syncAllSources, syncSource } from "./sync";
import type { FeedPosition, ListingProvider, MapResult, NormalizedListing } from "./types";

// The sync end to end against Postgres: syncSource → runSync → the Postgres
// store → upsertListings, with only the feed faked.

type Source = typeof dataSources.$inferSelect;
let source: Source;

beforeEach(async () => {
  await resetDb();
  source = await createSource();
});
afterAll(closeDb);

const ok = (n: NormalizedListing): MapResult => ({ ok: true, listing: n });
/** Feed timestamps of records the mapper skipped (the feed has them; MapResult doesn't). */
const skippedAt = new WeakMap<MapResult, number>();
const at = (n: MapResult) => (n.ok ? n.listing.sourceModifiedAt!.getTime() : skippedAt.get(n)!);
const keyOf = (n: MapResult) => (n.ok ? n.listing.listingKey : (n.listingKey ?? ""));

/** A keyset-paged fake feed over `records` (read at call time, so tests can change them). */
function feed(records: MapResult[], perPage = 2, opts: { failAfterPages?: number } = {}) {
  const calls: Array<FeedPosition | null> = [];
  const provider: ListingProvider = {
    async *fetchUpdates(from) {
      calls.push(from);
      const due = [...records]
        .sort((a, b) => at(a) - at(b) || keyOf(a).localeCompare(keyOf(b)))
        .filter((r) => {
          if (!from) return true;
          const t = from.modifiedAt.getTime();
          return from.key === null ? at(r) >= t : at(r) > t || (at(r) === t && keyOf(r) > from.key);
        });
      for (let i = 0; i * perPage < due.length; i++) {
        if (opts.failAfterPages !== undefined && i >= opts.failAfterPages) {
          throw new Error("RESO request failed (503)");
        }
        const items = due.slice(i * perPage, (i + 1) * perPage);
        const last = [...items].reverse().find((r) => r.ok);
        yield {
          items,
          last: last?.ok
            ? { modifiedAt: last.listing.sourceModifiedAt!, key: last.listing.listingKey }
            : null,
        };
      }
    },
    async *fetchActiveKeys() {
      yield records.flatMap((r) => (r.ok ? [r.listing.listingKey] : []));
    },
  };
  return { provider, calls };
}

async function row(key: string) {
  const [r] = await db.select().from(listings).where(eq(listings.listingKey, key));
  return r;
}

async function sourceRow() {
  const [r] = await db.select().from(dataSources).where(eq(dataSources.id, source.id));
  return r;
}

async function runs() {
  return db.select().from(syncRuns).orderBy(asc(syncRuns.startedAt), asc(syncRuns.finishedAt));
}

async function placeCount(label: string) {
  const { rows } = await db.execute<{ n: number }>(
    sql`select n from places where kind = 'city' and label = ${label}`,
  );
  return rows[0]?.n ?? 0;
}

const three = () => [1, 2, 3].map((i) => ok(listing(i, { city: "Testville" })));

describe("syncSource against Postgres", () => {
  it("writes new listings, saves the cursor with each page, records the run, and rebuilds places", async () => {
    const records = three();
    const result = await syncSource(source.id, { provider: feed(records).provider });
    expect(result).toMatchObject({ status: "succeeded", upserted: 3, unchanged: 0, changed: true });

    const s = await sourceRow();
    expect(s.syncCursor).toEqual(listing(3).sourceModifiedAt);
    expect(s.syncCursorKey).toBeNull(); // caught up
    expect(s.lastSyncedAt).not.toBeNull();
    const [run] = await runs();
    expect(run).toMatchObject({
      status: "succeeded",
      mode: "incremental",
      fetched: 3,
      upserted: 3,
    });
    expect(await placeCount("Testville")).toBe(3);
  });

  it("stops between pages with the cursor saved at the last record written, then continues right after it", async () => {
    const records = three();
    const { provider, calls } = feed(records, 2);
    // A deadline already past: the run stops after its first page.
    const first = await syncSource(source.id, { provider, deadline: Date.now() - 1 });
    expect(first).toMatchObject({ status: "partial", upserted: 2 });
    const s = await sourceRow();
    expect(s.syncCursor).toEqual(listing(2).sourceModifiedAt);
    expect(s.syncCursorKey).toBe(listing(2).listingKey);

    const second = await syncSource(source.id, { provider });
    expect(calls[1]).toEqual({
      modifiedAt: listing(2).sourceModifiedAt,
      key: listing(2).listingKey,
    });
    expect(second).toMatchObject({ status: "succeeded", upserted: 1, unchanged: 0 });
    expect((await sourceRow()).syncCursorKey).toBeNull();
  });

  it("leaves unchanged records alone and applies changed ones", async () => {
    const records = three();
    const { provider } = feed(records);
    await syncSource(source.id, { provider });
    const before = await row("K000001");

    // The same records again (the lookback re-reads them): nothing written.
    const same = await syncSource(source.id, { provider });
    expect(same).toMatchObject({ upserted: 0, unchanged: 3, changed: false });
    expect((await row("K000001")).updatedAt).toEqual(before.updatedAt);

    // The MLS changes one price (and its ModificationTimestamp).
    records[0] = ok(
      listing(1, {
        city: "Testville",
        listPrice: 250_000,
        sourceModifiedAt: new Date(listing(3).sourceModifiedAt!.getTime() + 60_000),
      }),
    );
    const changed = await syncSource(source.id, { provider });
    expect(changed).toMatchObject({ upserted: 1, unchanged: 2, changed: true });
    const after = await row("K000001");
    expect(after.listPrice).toBe(250_000);
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  });

  it("rewrites a record whose agent link changed on our side, though the feed's didn't", async () => {
    const records = [ok(listing(1, { listAgentMlsId: "GA-777" }))];
    const { provider } = feed(records);
    await syncSource(source.id, { provider });
    expect((await row("K000001")).listAgentId).toBeNull();

    const [agent] = await db
      .insert(agents)
      .values({ slug: "pat", name: "Pat Agent", email: "pat@example.com", mlsAgentId: "GA-777" })
      .returning();
    const again = await syncSource(source.id, { provider });
    expect(again.upserted).toBe(1);
    expect((await row("K000001")).listAgentId).toBe(agent.id);
  });

  it("purges a listing that left the feed, and brings it back when the feed sends it again", async () => {
    const records = three();
    await syncSource(source.id, { provider: feed(records).provider });

    const gone = records.pop()!;
    const purge = await syncSource(source.id, { mode: "purge", provider: feed(records).provider });
    expect(purge).toMatchObject({ status: "succeeded", removed: 1, changed: true });
    expect((await row("K000003")).removedAt).not.toBeNull();
    expect(await placeCount("Testville")).toBe(2);

    // Back in the feed, unchanged (same timestamp): it must come back anyway.
    records.push(gone);
    const back = await syncSource(source.id, { provider: feed(records).provider });
    expect(back.upserted).toBe(1);
    expect((await row("K000003")).removedAt).toBeNull();
    expect(await placeCount("Testville")).toBe(3);
  });

  it("takes down a listing whose seller opted out of internet display", async () => {
    const records = three();
    const { provider } = feed(records);
    await syncSource(source.id, { provider });
    // The MLS flips the display flag on K000002, which bumps its timestamp.
    const optOut: MapResult = { ok: false, listingKey: "K000002", reason: "not_displayable" };
    skippedAt.set(optOut, listing(3).sourceModifiedAt!.getTime() + 60_000);
    records.splice(1, 1, optOut);
    const result = await syncSource(source.id, { provider });
    expect(result).toMatchObject({ removed: 1, changed: true });
    expect(result.skipped).toEqual({ not_displayable: 1 });
    expect(await placeCount("Testville")).toBe(2);
    expect((await row("K000002")).removedAt).not.toBeNull();
    expect((await row("K000001")).removedAt).toBeNull();
  });

  it("a full run rewrites every stored row, repairing what an incremental run would skip", async () => {
    const records = three();
    const { provider } = feed(records);
    await syncSource(source.id, { provider });
    // A stored row gone wrong (say, a mapper bug since fixed).
    await db.update(listings).set({ listPrice: 1 }).where(eq(listings.listingKey, "K000002"));

    const incremental = await syncSource(source.id, { provider });
    expect(incremental.unchanged).toBe(3);
    expect((await row("K000002")).listPrice).toBe(1);

    const full = await syncSource(source.id, { mode: "full", provider });
    expect(full).toMatchObject({ upserted: 3, unchanged: 0 });
    expect((await row("K000002")).listPrice).toBe(listing(2).listPrice);
  });

  it("a run that fails keeps the pages it wrote, and says the caches need refreshing", async () => {
    const records = three();
    const error = await syncSource(source.id, {
      provider: feed(records, 2, { failAfterPages: 1 }).provider,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncFailedError);
    expect(error).toMatchObject({ changed: true, message: "RESO request failed (503)" });
    expect(await placeCount("Testville")).toBe(2);
    const [run] = await runs();
    expect(run).toMatchObject({
      status: "failed",
      upserted: 2,
      error: "RESO request failed (503)",
    });
    expect((await sourceRow()).syncCursorKey).toBe("K000002");
  });

  it("records a sync skipped because another run is still going", async () => {
    await db.insert(syncRuns).values({ sourceId: source.id, heartbeatAt: new Date() });
    const result = await syncSource(source.id, { provider: feed(three()).provider });
    expect(result).toMatchObject({ status: "skipped", runId: null });
    const all = await runs();
    expect(all.map((r) => r.status)).toEqual(["running", "skipped"]);
    expect(all[1].error).toMatch(/another sync of this feed was still running/);
    expect(await db.$count(listings)).toBe(0);
  });
});

describe("syncSource: the run's deadline reaches the RESO feed", () => {
  // The real provider (createProvider), with only the HTTP layer faked. The
  // engine checks the deadline between pages; inside a page only the feed
  // client can stop, so it must get the deadline (plus FEED_GRACE_MS).
  let fetchCalls = 0;
  beforeEach(() => {
    fetchCalls = 0;
    vi.stubEnv("MLS_TOKEN", "t");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** A feed server that never answers: the request ends only when aborted. */
  const hangingFetch = (init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      fetchCalls++;
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    });

  it("cuts off a request still in flight FEED_GRACE_MS after the deadline, and records the run failed", async () => {
    vi.stubGlobal("fetch", (_url: string, init?: RequestInit) => hangingFetch(init));
    // The deadline passed just under FEED_GRACE_MS ago: the page may start, with ~0.3 s left.
    const deadline = Date.now() - FEED_GRACE_MS + 300;
    const started = Date.now();
    const error = await syncSource(source.id, { deadline }).catch((e: unknown) => e);
    // Without the deadline the client would wait out its 60 s request timeout.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(fetchCalls).toBe(1);
    expect(error).toBeInstanceOf(SyncFailedError);
    expect((error as Error).message).toMatch(/RESO request gave up/);
    const [run] = await runs();
    expect(run).toMatchObject({ status: "failed" });
    expect(run.finishedAt).not.toBeNull();
  });

  it("starts no request once the deadline plus FEED_GRACE_MS has passed", async () => {
    vi.stubGlobal("fetch", async () => {
      fetchCalls++;
      return Response.json({ value: [] });
    });
    const error = await syncSource(source.id, {
      deadline: Date.now() - FEED_GRACE_MS - 1_000,
    }).catch((e: unknown) => e);
    expect(fetchCalls).toBe(0);
    expect(error).toBeInstanceOf(SyncFailedError);
    expect((error as Error).message).toMatch(/out of time after 0 attempt/);
  });

  it("keeps the grace inside the cron's 45 s margin (deadline = maxDuration − 45 s)", () => {
    expect(FEED_GRACE_MS).toBeGreaterThan(0);
    expect(FEED_GRACE_MS).toBeLessThan(45_000);
  });
});

describe("syncAllSources: a feed without credentials", () => {
  beforeEach(async () => {
    await db
      .update(dataSources)
      .set({
        config: { baseUrl: "https://feed.example.com/odata", credentialsEnvPrefix: "MLS_GAMLS" },
      })
      .where(eq(dataSources.id, source.id));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("is skipped with a note and records no run", async () => {
    vi.stubEnv("MLS_GAMLS_TOKEN", "");
    const results = await syncAllSources({ mode: "purge" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      source: source.slug,
      ok: true,
      note: expect.stringMatching(/MLS_GAMLS_TOKEN/),
      result: { status: "skipped", mode: "purge", runId: null },
    });
    expect(await db.$count(syncRuns)).toBe(0);
  });

  it("syncs once the token is set", async () => {
    vi.stubEnv("MLS_GAMLS_TOKEN", "t");
    vi.stubGlobal("fetch", async () => Response.json({ value: [] }));
    const results = await syncAllSources();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: true, result: { status: "succeeded" } });
    expect(results[0]).not.toHaveProperty("note");
    expect(await db.$count(syncRuns)).toBe(1);
  });
});

describe("createSyncStore().beginRun", () => {
  it("marks a run that stopped heartbeating as failed and starts a new one", async () => {
    const old = new Date(Date.now() - STALE_RUN_MS - 60_000);
    const [dead] = await db
      .insert(syncRuns)
      .values({ sourceId: source.id, startedAt: old, heartbeatAt: old })
      .returning();
    const store = createSyncStore(source);
    const begun = await store.beginRun("incremental", new Date(Date.now() - STALE_RUN_MS));
    expect(begun.staleFailed).toBe(1);
    expect(begun.runId).not.toBeNull();
    const [after] = await db.select().from(syncRuns).where(eq(syncRuns.id, dead.id));
    expect(after).toMatchObject({ status: "failed", error: STALE_RUN_ERROR });
    expect(after.finishedAt).not.toBeNull();
  });

  it("starts nothing while another run is alive", async () => {
    await db.insert(syncRuns).values({ sourceId: source.id, heartbeatAt: new Date() });
    const store = createSyncStore(source);
    const begun = await store.beginRun("incremental", new Date(Date.now() - STALE_RUN_MS));
    expect(begun).toEqual({ runId: null, staleFailed: 0 });
  });

  it("serializes run starts across processes with an advisory lock", async () => {
    // Another process (a CLI run, say) holds the source's lock.
    const other = new Client({ connectionString: process.env.DATABASE_URL });
    await other.connect();
    try {
      await other.query("select pg_advisory_lock(hashtextextended($1, 0))", [`sync:${source.id}`]);
      let settled = false;
      const begun = createSyncStore(source)
        .beginRun("incremental", new Date(Date.now() - STALE_RUN_MS))
        .finally(() => {
          settled = true;
        });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await other.query("select pg_advisory_unlock(hashtextextended($1, 0))", [
        `sync:${source.id}`,
      ]);
      expect((await begun).runId).not.toBeNull();
    } finally {
      await other.end();
    }
  });
});
