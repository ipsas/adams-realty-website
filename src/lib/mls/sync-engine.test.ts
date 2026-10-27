import { DrizzleQueryError } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { purgeCountQuery, purgeScope, purgeWhere } from "./purge";
import {
  PURGE_CAP_PREFIX,
  PURGE_RESERVE_MS,
  PURGE_SKIPPED_PREFIX,
  PURGE_WAIT_POLL_MS,
  PurgeCapError,
  runSync,
  UPDATE_LOOKBACK_MS,
  type MapperVersions,
  type PageOutcome,
  type RunOutcome,
  type SyncCounts,
  type SyncCursor,
  type SyncMode,
  type SyncStore,
} from "./sync-engine";
import type {
  FeedPosition,
  ListingProvider,
  MapResult,
  NormalizedListing,
  PurgeScope,
} from "./types";
import { describeError, PageRejectedError, writeIsolated } from "./write-errors";

// The engine against an in-memory store and a fake feed on a fake clock:
// every page "takes" PAGE_MS, so a 300 s function is simulated instantly.

const PAGE_MS = 10_000;
const START = Date.parse("2026-09-25T09:00:00Z");
const SOURCE_ID = "b35e5476-2b15-4c16-908b-020063e6a746";
/** Postgres rejects a statement with more bind parameters than this. */
const PG_MAX_PARAMS = 65_535;

/** node-postgres's error for a value too big for an `integer`, wrapped as drizzle does. */
const outOfRange = (key: string) =>
  new DrizzleQueryError(
    'insert into "listings" …',
    [key],
    Object.assign(new Error('value "2182094640" is out of range for type integer'), {
      code: "22003",
    }),
  );

let now = START;
const clock = () => now;
/** The engine's waits, on the fake clock. */
const sleep = async (ms: number) => {
  now += ms;
};

type StoredListing = {
  status: NormalizedListing["status"];
  closeDate: string | null;
  modified: number;
  removed: boolean;
  /** Fake-clock time of the removal, for pruning. */
  removedAt?: number;
};

type Run = {
  id: string;
  mode: SyncMode;
  status: RunOutcome["status"] | "running" | "skipped";
  heartbeat: number;
  counts?: SyncCounts;
  cursor?: Date | null;
  error?: string;
};

class MemoryStore implements SyncStore {
  listings = new Map<string, StoredListing>();
  cursor: SyncCursor | null = null;
  runs: Run[] = [];
  purgeParams: number[] = [];
  /** `before` as passed to each pruneRemoved. */
  pruneCalls: Date[] = [];
  /** skipUnchanged as passed to each writePage. */
  skipFlags: boolean[] = [];
  /** Called on every beginRun (lets a test finish a blocking run after a while). */
  onBeginRun: () => void = () => {};

  async beginRun(mode: SyncMode, staleBefore: Date) {
    this.onBeginRun();
    let staleFailed = 0;
    for (const r of this.runs) {
      if (r.status === "running" && r.heartbeat < staleBefore.getTime()) {
        r.status = "failed";
        r.error = "cut off";
        staleFailed++;
      }
    }
    if (this.runs.some((r) => r.status === "running")) return { runId: null, staleFailed };
    const run: Run = { id: `run-${this.runs.length + 1}`, mode, status: "running", heartbeat: now };
    this.runs.push(run);
    return { runId: run.id, staleFailed };
  }

  async recordSkipped(mode: SyncMode, status: "skipped" | "failed", message: string) {
    this.runs.push({
      id: `run-${this.runs.length + 1}`,
      mode,
      status,
      heartbeat: now,
      error: message,
    });
  }

  async savedCursor() {
    return this.cursor;
  }

  versions: MapperVersions = { done: null, remappingTo: null };
  async mapperVersions() {
    return { ...this.versions };
  }

  async writePage(
    page: MapResult[],
    cursor: SyncCursor | null,
    { skipUnchanged }: { skipUnchanged: boolean },
  ): Promise<PageOutcome> {
    this.skipFlags.push(skipUnchanged);
    // Restored when the page fails, as the Postgres store's transaction rolls back.
    const snapshot = structuredClone(this.listings);
    let upserted = 0;
    let unchanged = 0;
    let removed = 0;
    for (const item of page) {
      if (!item.ok) {
        const l = item.listingKey ? this.listings.get(item.listingKey) : undefined;
        if (item.reason === "not_displayable" && l && !l.removed) {
          l.removed = true;
          removed++;
        }
      }
    }
    // Batches through writeIsolated like the Postgres store; a batch holding a
    // rejected key fails whole, as Postgres fails the multi-row upsert.
    const { failed } = await writeIsolated(
      page.flatMap((item) => (item.ok ? [item.listing] : [])),
      async (batch) => {
        const bad = batch.find((n) => this.rejectKeys.has(n.listingKey));
        if (bad) throw outOfRange(bad.listingKey);
        for (const n of batch) {
          const modified = n.sourceModifiedAt!.getTime();
          const prev = this.listings.get(n.listingKey);
          if (skipUnchanged && prev && !prev.removed && prev.modified === modified) {
            unchanged++;
            continue;
          }
          this.listings.set(n.listingKey, {
            status: n.status,
            closeDate: n.closeDate ?? null,
            modified,
            removed: false,
          });
          upserted++;
        }
        return batch;
      },
      (n, error) => this.failures.push(`${n.listingKey}: ${describeError(error)}`),
    ).catch((error: unknown) => {
      this.listings = snapshot;
      throw error;
    });
    this.cursor = cursor;
    return { upserted, unchanged, removed, failed: failed.length, mediaRowsWritten: 0, nulled: 0 };
  }

  /** Keys Postgres "rejects" (an out-of-range value), and what was logged for them. */
  rejectKeys = new Set<string>();
  failures: string[] = [];

  async heartbeat(runId: string, counts: SyncCounts) {
    const run = this.runs.find((r) => r.id === runId)!;
    run.heartbeat = now;
    run.counts = { ...counts };
  }

  /**
   * Renders the statement the Postgres store sends (`purgeCountQuery`, then
   * `purgeWhere`) and fails the way Postgres does if it binds too many parameters.
   */
  private missing(feedKeys: string[], scope: PurgeScope, statement: typeof purgeWhere) {
    const { params } = new PgDialect().sqlToQuery(statement(SOURCE_ID, feedKeys, scope));
    this.purgeParams.push(params.length);
    if (params.length > PG_MAX_PARAMS) {
      throw new Error(
        `bind message has ${params.length % 65_536} parameter formats but 0 parameters`,
      );
    }
    const keys = new Set(feedKeys);
    const inScope = [...this.listings].filter(
      ([, l]) =>
        !l.removed &&
        (scope.liveOnly ||
          ["active", "coming_soon", "active_under_contract", "pending"].includes(l.status) ||
          (l.status === "closed" && !!l.closeDate && l.closeDate >= scope.closedSince)),
    );
    return { inScope, missing: inScope.filter(([key]) => !keys.has(key)) };
  }

  async countPurge(feedKeys: string[], scope: PurgeScope) {
    const { inScope, missing } = this.missing(feedKeys, scope, purgeCountQuery);
    return { inScope: inScope.length, missing: missing.length };
  }

  async purge(feedKeys: string[], scope: PurgeScope) {
    const { missing } = this.missing(feedKeys, scope, purgeWhere);
    for (const [, l] of missing) Object.assign(l, { removed: true, removedAt: now });
    return missing.length;
  }

  async pruneRemoved(before: Date) {
    this.pruneCalls.push(before);
    let pruned = 0;
    for (const [key, l] of this.listings) {
      if (l.removed && l.removedAt !== undefined && l.removedAt < before.getTime()) {
        this.listings.delete(key);
        pruned++;
      }
    }
    return pruned;
  }

  async finishRun(runId: string, outcome: RunOutcome) {
    if (outcome.status !== "failed" && outcome.caughtUp && this.cursor) {
      this.cursor = { ...this.cursor, key: null };
    }
    if (outcome.mapperVersion !== undefined) {
      this.versions =
        outcome.status === "succeeded" && outcome.caughtUp
          ? { done: outcome.mapperVersion, remappingTo: null }
          : { ...this.versions, remappingTo: outcome.mapperVersion };
    }
    Object.assign(
      this.runs.find((r) => r.id === runId)!,
      {
        status: outcome.status,
        counts: outcome.counts,
        cursor: outcome.cursor,
        error: outcome.error,
        heartbeat: now,
      },
    );
  }

  live() {
    return [...this.listings.values()].filter((l) => !l.removed).length;
  }
}

function record(i: number, over: Partial<NormalizedListing> = {}): MapResult {
  return {
    ok: true,
    listing: {
      listingKey: `K${String(i).padStart(6, "0")}`,
      status: "active",
      propertyType: "single_family",
      listPrice: 300_000 + i,
      addressLine1: `${i} Main St`,
      city: "Athens",
      state: "GA",
      postalCode: "30601",
      listAgentMlsId: null,
      // One second apart, oldest first, like the RESO feed's $orderby.
      sourceModifiedAt: new Date(START - 86_400_000 + i * 1000),
      media: [],
      openHouses: [],
      ...over,
    },
  };
}

const modifiedOf = (r: MapResult) => (r.ok ? r.listing.sourceModifiedAt!.getTime() : 0);
const keyOf = (r: MapResult) => (r.ok ? r.listing.listingKey : "");

/** Records at or after `from` in (timestamp, key) order, like the RESO provider's filter. */
function dueFrom(records: MapResult[], from: FeedPosition | null) {
  const sorted = [...records].sort(
    (a, b) => modifiedOf(a) - modifiedOf(b) || keyOf(a).localeCompare(keyOf(b)),
  );
  if (!from) return sorted;
  const t = from.modifiedAt.getTime();
  return sorted.filter((r) =>
    from.key === null
      ? modifiedOf(r) >= t
      : modifiedOf(r) > t || (modifiedOf(r) === t && keyOf(r) > from.key!),
  );
}

function pageOf(items: MapResult[]) {
  const last = items[items.length - 1];
  return {
    items,
    last: last?.ok
      ? { modifiedAt: last.listing.sourceModifiedAt!, key: last.listing.listingKey }
      : null,
  };
}

/**
 * A feed of `pages` × `perPage` records; each page takes PAGE_MS on the fake
 * clock (or `pageMs(i)` for page i of a run). `records` can be changed between runs.
 */
function feed(pages: number, perPage = 200, pageMs: (i: number) => number = () => PAGE_MS) {
  const records = Array.from({ length: pages * perPage }, (_, i) => record(i));
  const calls: Array<FeedPosition | null> = [];
  const provider: ListingProvider = {
    async *fetchUpdates(from) {
      calls.push(from);
      const due = dueFrom(records, from);
      for (let i = 0; i * perPage < due.length; i++) {
        now += pageMs(i);
        yield pageOf(due.slice(i * perPage, (i + 1) * perPage));
      }
    },
    fetchActiveKeys() {
      throw new Error("an incremental run must not fetch the key list");
    },
  };
  return { provider, calls, records };
}

/** A feed that only answers the purge's key list, `perPage` keys per page. */
function keyFeed(keys: string[], perPage = 1000) {
  const scopes: PurgeScope[] = [];
  const provider: ListingProvider = {
    fetchUpdates() {
      throw new Error("a purge-only run must not fetch updates");
    },
    async *fetchActiveKeys(scope) {
      scopes.push(scope);
      for (let i = 0; i < keys.length; i += perPage) {
        now += 1000;
        yield keys.slice(i, i + perPage);
      }
    },
  };
  return { provider, scopes };
}

/** Seeds `n` live listings K000000…, as a previous sync would have left them. */
function seedLive(store: MemoryStore, n: number) {
  for (let i = 0; i < n; i++) {
    store.listings.set(`K${String(i).padStart(6, "0")}`, {
      status: "active",
      closeDate: null,
      modified: 0,
      removed: false,
    });
  }
}

const keysOf = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => `K${String(from + i).padStart(6, "0")}`);

let store: MemoryStore;
beforeEach(() => {
  now = START;
  store = new MemoryStore();
});

describe("runSync: time budget and resume", () => {
  it("stops between pages before the deadline, ends partial with the cursor saved, and the next run finishes", async () => {
    const { provider, calls, records } = feed(50);
    const deadline = START + 255_000; // maxDuration 300 s − 45 s

    const first = await runSync(store, provider, { deadline, now: clock });
    expect(first.status).toBe("partial");
    expect(now).toBeLessThanOrEqual(deadline);
    const pagesDone = first.upserted / 200;
    expect(pagesDone).toBe(25);
    expect(store.runs[0]).toMatchObject({ status: "partial" });
    // The cursor is the last record written (timestamp and key), saved with the page.
    const lastWritten = records[first.upserted - 1];
    if (!lastWritten.ok) throw new Error("fixture");
    expect(store.cursor).toEqual({
      modifiedAt: lastWritten.listing.sourceModifiedAt,
      key: lastWritten.listing.listingKey,
    });
    expect(store.runs[0].cursor).toEqual(lastWritten.listing.sourceModifiedAt);

    const second = await runSync(store, provider, { deadline: now + 1_000_000, now: clock });
    // Resumed exactly after the last record written: nothing is read twice.
    expect(calls[1]).toEqual({
      modifiedAt: lastWritten.listing.sourceModifiedAt,
      key: lastWritten.listing.listingKey,
    });
    expect(second.status).toBe("succeeded");
    expect(second.upserted).toBe(10_000 - first.upserted);
    expect(second.unchanged).toBe(0);
    expect(store.live()).toBe(10_000);
    // Caught up: the next run starts afresh (with the lookback).
    expect(store.cursor?.key).toBeNull();
  });

  it("gets through more same-timestamp records than one run can read, across runs", async () => {
    // An MLS bulk edit: 10,000 records stamped with the same second, 25 pages per run.
    const { provider, records } = feed(50);
    const bulk = new Date(START - 3_600_000);
    for (const r of records) if (r.ok) r.listing.sourceModifiedAt = bulk;
    let runs = 0;
    let unchanged = 0;
    let result;
    do {
      result = await runSync(store, provider, { deadline: now + 255_000, now: clock });
      unchanged += result.unchanged;
      runs++;
    } while (result.status === "partial" && runs < 5);
    expect(result.status).toBe("succeeded");
    expect(store.live()).toBe(10_000);
    // Each run picked up where the last stopped, inside the one timestamp.
    expect(unchanged).toBe(0);
    expect(runs).toBeLessThanOrEqual(3);
  });

  it("re-reads the lookback window on a fresh run, so a record the feed showed late isn't missed", async () => {
    const { provider, records, calls } = feed(1, 100);
    await runSync(store, provider, { now: clock });
    const cursor = store.cursor!;
    expect(cursor.key).toBeNull();

    // The MLS publishes an update stamped 10 minutes before our cursor (replication lag).
    const late = record(5_000, {
      listingKey: "LATE-1",
      sourceModifiedAt: new Date(cursor.modifiedAt.getTime() - 10 * 60_000),
    });
    records.push(late);
    const next = await runSync(store, provider, { now: clock });
    expect(calls[1]).toEqual({
      modifiedAt: new Date(cursor.modifiedAt.getTime() - UPDATE_LOOKBACK_MS),
      key: null,
    });
    expect(next.upserted).toBe(1);
    expect(store.listings.has("LATE-1")).toBe(true);
    // Re-read records inside the window cost nothing: they're unchanged.
    expect(next.unchanged).toBeGreaterThan(0);
    expect(next.changed).toBe(true);
  });

  it("stops early enough that a page 1.4× slower than the slowest so far still ends in time", async () => {
    // 10 s pages, then one slower page right where a run without slack would squeeze it in.
    const deadline = START + 252_000;
    const { provider } = feed(50, 200, (i) => (i === 24 ? 14_000 : PAGE_MS));
    const result = await runSync(store, provider, { deadline, now: clock });
    expect(result.status).toBe("partial");
    expect(now).toBeLessThanOrEqual(deadline);
    // …but not needlessly early either: page 25 would have ended at 250 s.
    expect(result.upserted / 200).toBe(24);
  });

  it("without a deadline runs to the end", async () => {
    const { provider } = feed(50);
    const result = await runSync(store, provider, { now: clock });
    expect(result).toMatchObject({ status: "succeeded", upserted: 10_000, changed: true });
  });

  it("marks a run that stopped heartbeating as failed, then runs", async () => {
    store.runs.push({
      id: "old",
      mode: "incremental",
      status: "running",
      heartbeat: START - 301_000,
    });
    const result = await runSync(store, feed(1).provider, { now: clock });
    expect(result.staleRunsFailed).toBe(1);
    expect(store.runs[0]).toMatchObject({ status: "failed", error: "cut off" });
    expect(result.status).toBe("succeeded");
  });

  it("leaves a run that is still heartbeating alone, does nothing, and records the skip", async () => {
    store.runs.push({ id: "live", mode: "full", status: "running", heartbeat: START - 5_000 });
    const { provider, calls } = feed(1);
    const result = await runSync(store, provider, { now: clock, sleep });
    expect(result).toMatchObject({ status: "skipped", runId: null, changed: false });
    expect(calls).toHaveLength(0);
    expect(store.runs[0].status).toBe("running");
    // Visible in the run list, not silently dropped.
    expect(store.runs).toHaveLength(2);
    expect(store.runs[1]).toMatchObject({ mode: "incremental", status: "skipped" });
    // An incremental sync doesn't wait: the next one carries on.
    expect(now).toBe(START);
  });

  it("a full run ignores the saved cursor and rewrites unchanged records", async () => {
    const { provider, calls } = feed(2);
    await runSync(store, provider, { now: clock });
    const again = await runSync(store, provider, { mode: "full", now: clock });
    expect(calls[1]).toBeNull();
    // A full run is how stored rows get repaired (a mapper fix, a new column).
    expect(again).toMatchObject({ upserted: 400, unchanged: 0 });
    expect(store.skipFlags).toEqual([true, true, false, false]);
    // An incremental run skips them.
    const incremental = await runSync(store, provider, { now: clock });
    expect(incremental).toMatchObject({ upserted: 0, unchanged: 400, changed: false });
  });

  it("skips a record Postgres rejects, writes the rest of its page, and carries on", async () => {
    // The full sync stopped at 33,165 of ~68k: one record failed its page's upsert every run.
    const { provider, records } = feed(3);
    const bad = keyOf(records[250]);
    store.rejectKeys.add(bad);
    const result = await runSync(store, provider, { mode: "full", now: clock });
    expect(result).toMatchObject({ status: "succeeded", fetched: 600, upserted: 599 });
    expect(result.skipped).toEqual({ write_failed: 1 });
    expect(store.listings.has(bad)).toBe(false);
    expect(store.live()).toBe(599);
    // Logged with its key and the real Postgres error, not "Failed query: …".
    expect(store.failures).toEqual([
      `${bad}: value "[redacted]" is out of range for type integer (code: 22003)`,
    ]);
    // Past the bad page: the cursor is the feed's last record, and the run caught up.
    expect(store.cursor).toEqual({ modifiedAt: new Date(modifiedOf(records[599])), key: null });
    expect(store.runs[0]).toMatchObject({ status: "succeeded", error: undefined });
  });

  it("fails the run on a page whose every row is rejected: nothing of it written, cursor kept", async () => {
    const { provider, records } = feed(2, 10);
    for (const r of records.slice(10)) store.rejectKeys.add(keyOf(r));
    await expect(runSync(store, provider, { now: clock })).rejects.toThrow(PageRejectedError);
    // The first page went in; the cursor stays on its last record.
    const lastGood = { modifiedAt: new Date(modifiedOf(records[9])), key: keyOf(records[9]) };
    expect(store.cursor).toEqual(lastGood);
    expect(store.live()).toBe(10);
    expect(store.runs[0]).toMatchObject({ status: "failed", cursor: lastGood.modifiedAt });
    expect(store.runs[0].counts).toMatchObject({ fetched: 20, upserted: 10 });
    expect(store.runs[0].error).toBe(
      "10 of 10 rows rejected on page; not advancing cursor. First error: " +
        'value "[redacted]" is out of range for type integer (code: 22003)',
    );
  });

  it("fails a page of 10 rows with more than half rejected, writing none of it", async () => {
    const { provider, records } = feed(1, 10);
    for (const i of [0, 1, 3, 5, 7, 9]) store.rejectKeys.add(keyOf(records[i]));
    await expect(runSync(store, provider, { now: clock })).rejects.toThrow(
      /^6 of 10 rows rejected on page; not advancing cursor/,
    );
    expect(store.live()).toBe(0);
    expect(store.cursor).toBeNull();
    expect(store.runs[0]).toMatchObject({ status: "failed", cursor: null });
  });

  it("still skips one bad row in 10, and advances past it", async () => {
    const { provider, records } = feed(1, 10);
    store.rejectKeys.add(keyOf(records[4]));
    const result = await runSync(store, provider, { now: clock });
    expect(result).toMatchObject({ status: "succeeded", upserted: 9 });
    expect(result.skipped).toEqual({ write_failed: 1 });
    expect(store.cursor).toEqual({ modifiedAt: new Date(modifiedOf(records[9])), key: null });
  });

  it("on a page under 10 rows, skips rejected rows, as before", async () => {
    const { provider, records } = feed(1, 9);
    for (const i of [0, 2, 4, 6, 8]) store.rejectKeys.add(keyOf(records[i]));
    const result = await runSync(store, provider, { now: clock });
    expect(result).toMatchObject({ status: "succeeded", upserted: 4 });
    expect(result.skipped).toEqual({ write_failed: 5 });
    expect(store.cursor).toEqual({ modifiedAt: new Date(modifiedOf(records[8])), key: null });
  });

  it("skips a lone bad record on a 1-row page and advances past it", async () => {
    // A permanently bad record alone on the incremental page must not stall the cron.
    const { provider, records } = feed(1, 1);
    store.rejectKeys.add(keyOf(records[0]));
    const result = await runSync(store, provider, { now: clock });
    expect(result).toMatchObject({ status: "succeeded", upserted: 0 });
    expect(result.skipped).toEqual({ write_failed: 1 });
    expect(store.live()).toBe(0);
    expect(store.cursor).toEqual({ modifiedAt: new Date(modifiedOf(records[0])), key: null });
    expect(store.runs[0]).toMatchObject({ status: "succeeded", error: undefined });
  });

  it("adds up the values the sanitizer nulled", async () => {
    const write = store.writePage.bind(store);
    store.writePage = async (...args) => ({ ...(await write(...args)), nulled: 2 });
    const result = await runSync(store, feed(3).provider, { now: clock });
    expect(result.nulled).toBe(6);
  });

  it("records the real Postgres error when a page fails for another reason", async () => {
    const { provider } = feed(1);
    store.writePage = async () => {
      throw new DrizzleQueryError(
        'update "data_sources" …',
        [],
        Object.assign(new Error("terminating connection due to administrator command"), {
          code: "57P01",
        }),
      );
    };
    await expect(runSync(store, provider, { now: clock })).rejects.toThrow(DrizzleQueryError);
    expect(store.runs[0]).toMatchObject({
      status: "failed",
      error: "terminating connection due to administrator command (code: 57P01)",
    });
  });

  it("records a failure with its message and rethrows", async () => {
    const provider: ListingProvider = {
      async *fetchUpdates() {
        throw new Error("RESO request failed (503)");
      },
      fetchActiveKeys: () => {
        throw new Error("unused");
      },
    };
    await expect(runSync(store, provider, { now: clock })).rejects.toThrow("503");
    expect(store.runs[0]).toMatchObject({ status: "failed", error: "RESO request failed (503)" });
  });
});

describe("runSync: mapper version", () => {
  /** `feed(...)` whose provider reports mapper version `v`. */
  function versionedFeed(v: number, pages: number) {
    const f = feed(pages);
    return { ...f, provider: { ...f.provider, mapperVersion: v } };
  }

  it("with the stored version, behaves as before: lookback, unchanged records skipped", async () => {
    store.versions = { done: 2, remappingTo: null };
    const { provider, calls } = versionedFeed(2, 2);
    await runSync(store, provider, { now: clock });
    const cursor = store.cursor!;
    const again = await runSync(store, provider, { now: clock });
    expect(calls[1]).toEqual({
      modifiedAt: new Date(cursor.modifiedAt.getTime() - UPDATE_LOOKBACK_MS),
      key: null,
    });
    expect(again).toMatchObject({ upserted: 0, unchanged: 400 });
    expect(store.skipFlags).toEqual([true, true, true, true]);
    expect(store.versions).toEqual({ done: 2, remappingTo: null });
  });

  it("with a different version, reads from no cursor and rewrites every record, then saves it", async () => {
    // Rows written by the previous mapper, caught up.
    const old = feed(2);
    await runSync(store, old.provider, { now: clock });
    store.versions = { done: 1, remappingTo: null };

    const { provider, calls } = versionedFeed(2, 2);
    const remap = await runSync(store, provider, { now: clock });
    expect(calls[0]).toBeNull();
    expect(remap).toMatchObject({ status: "succeeded", upserted: 400, unchanged: 0 });
    expect(store.skipFlags.slice(2)).toEqual([false, false]);
    expect(store.versions).toEqual({ done: 2, remappingTo: null });

    // Done: the next run is an ordinary incremental one.
    const next = await runSync(store, provider, { now: clock });
    expect(calls[1]?.key).toBeNull();
    expect(calls[1]).not.toBeNull();
    expect(next).toMatchObject({ upserted: 0, unchanged: 400 });
  });

  it("a remap stopped partway saves no version, and the next run resumes it without skipping", async () => {
    const { provider, calls } = versionedFeed(2, 50);
    const first = await runSync(store, provider, { deadline: START + 255_000, now: clock });
    expect(first.status).toBe("partial");
    expect(store.versions).toEqual({ done: null, remappingTo: 2 });
    const resumeAt = store.cursor!;
    expect(resumeAt.key).not.toBeNull();

    const second = await runSync(store, provider, { deadline: now + 1_000_000, now: clock });
    expect(calls[1]).toEqual(resumeAt);
    expect(second.status).toBe("succeeded");
    expect(store.skipFlags.every((f) => f === false)).toBe(true);
    expect(store.versions).toEqual({ done: 2, remappingTo: null });
  });

  it("doesn't resume an older mapper's partial cursor: starts from no cursor", async () => {
    const old = feed(50);
    await runSync(store, old.provider, { deadline: START + 255_000, now: clock });
    expect(store.cursor?.key).not.toBeNull();

    const { provider, calls } = versionedFeed(2, 50);
    await runSync(store, provider, { now: clock });
    expect(calls[0]).toBeNull();
    expect(store.versions).toEqual({ done: 2, remappingTo: null });
  });

  it("a remap that fails before writing a page leaves the versions alone", async () => {
    store.cursor = { modifiedAt: new Date(START - 60_000), key: "K000010" };
    const provider: ListingProvider = {
      mapperVersion: 2,
      async *fetchUpdates() {
        throw new Error("RESO request failed (503)");
      },
      fetchActiveKeys: () => {
        throw new Error("unused");
      },
    };
    await expect(runSync(store, provider, { now: clock })).rejects.toThrow("503");
    expect(store.versions).toEqual({ done: null, remappingTo: null });
  });

  it("a purge neither checks nor saves the version", async () => {
    seedLive(store, 10);
    const { provider } = keyFeed(keysOf(10));
    await runSync(store, { ...provider, mapperVersion: 2 }, { mode: "purge", now: clock });
    expect(store.versions).toEqual({ done: null, remappingTo: null });
  });
});

describe("runSync: purge", () => {
  it("is purge-only: never fetches updates, removes what left the feed, keeps the cursor", async () => {
    seedLive(store, 1000);
    store.cursor = { modifiedAt: new Date(START - 60_000), key: null };
    const { provider, scopes } = keyFeed(keysOf(980)); // 20 listings (2%) left the feed
    const result = await runSync(store, provider, { mode: "purge", now: clock });
    expect(result).toMatchObject({
      status: "succeeded",
      mode: "purge",
      removed: 20,
      fetched: 980,
      // Removals alone must refresh the caches and places.
      changed: true,
    });
    expect(store.live()).toBe(980);
    expect(store.cursor).toEqual({ modifiedAt: new Date(START - 60_000), key: null });
    // The feed is asked for the scope the site keeps: live, plus sales closed in the last year.
    expect(scopes).toEqual([purgeScope(new Date(START))]);
    expect(scopes[0].closedSince).toBe("2025-09-25");
  });

  it("waits for a sync that is still running instead of skipping, then purges", async () => {
    seedLive(store, 1000);
    store.runs.push({ id: "sync", mode: "incremental", status: "running", heartbeat: START });
    // The sync finishes 40 s later.
    store.onBeginRun = () => {
      if (now >= START + 40_000) store.runs[0].status = "succeeded";
    };
    const result = await runSync(store, keyFeed(keysOf(990)).provider, {
      mode: "purge",
      deadline: START + 255_000,
      now: clock,
      sleep,
    });
    expect(result).toMatchObject({ status: "succeeded", removed: 10 });
    expect(now).toBeGreaterThanOrEqual(START + 40_000);
    expect(store.runs.map((r) => r.status)).toEqual(["succeeded", "succeeded"]);
  });

  it("fails loudly, recorded, when the other run outlasts its wait", async () => {
    seedLive(store, 1000);
    store.runs.push({ id: "sync", mode: "incremental", status: "running", heartbeat: START });
    store.onBeginRun = () => {
      store.runs[0].heartbeat = now; // still alive
    };
    const deadline = START + 255_000;
    await expect(
      runSync(store, keyFeed(keysOf(990)).provider, { mode: "purge", deadline, now: clock, sleep }),
    ).rejects.toThrow(PURGE_SKIPPED_PREFIX);
    // It gave up in time to leave the purge its reserve, and removed nothing.
    expect(now).toBeLessThanOrEqual(deadline - PURGE_RESERVE_MS);
    expect(now).toBeGreaterThan(deadline - PURGE_RESERVE_MS - PURGE_WAIT_POLL_MS);
    expect(store.live()).toBe(1000);
    expect(store.runs[1]).toMatchObject({ mode: "purge", status: "failed" });
    expect(store.runs[1].error).toMatch(new RegExp(`^${PURGE_SKIPPED_PREFIX}`));
  });

  // The cron gives a run 255 s (maxDuration 300 s − 45 s). A statewide key
  // download is ~70 pages of 1,000 keys; at 1 s a page it needs over a minute.
  it("never starts a key download without two minutes of its budget left: it fails as skipped instead", async () => {
    seedLive(store, 70_000);
    store.runs.push({ id: "sync", mode: "incremental", status: "running", heartbeat: START });
    // The sync finishes 200 s in: too late for a 70-page download before the deadline.
    store.onBeginRun = () => {
      if (now >= START + 200_000) store.runs[0].status = "succeeded";
      else store.runs[0].heartbeat = now;
    };
    const deadline = START + 255_000;
    const { provider, scopes } = keyFeed(keysOf(69_500));
    await expect(
      runSync(store, provider, { mode: "purge", deadline, now: clock, sleep }),
    ).rejects.toThrow(PURGE_SKIPPED_PREFIX);
    expect(scopes).toEqual([]); // never asked the feed for keys
    expect(deadline - now).toBeGreaterThanOrEqual(120_000);
    expect(store.live()).toBe(70_000);
  });

  it("with the lock at the last moment it waits for, still finishes a statewide purge before the deadline", async () => {
    seedLive(store, 70_000);
    store.runs.push({ id: "sync", mode: "incremental", status: "running", heartbeat: START });
    const deadline = START + 255_000;
    // The sync finishes exactly when the purge's wait would end.
    store.onBeginRun = () => {
      if (now >= deadline - 120_000) store.runs[0].status = "succeeded";
      else store.runs[0].heartbeat = now;
    };
    const result = await runSync(store, keyFeed(keysOf(69_500)).provider, {
      mode: "purge",
      deadline,
      now: clock,
      sleep,
    });
    expect(result).toMatchObject({ status: "succeeded", removed: 500 });
    expect(now).toBeLessThanOrEqual(deadline);
  });

  it("works with more keys than Postgres has bind parameters (100,000)", async () => {
    seedLive(store, 100_000);
    const { provider } = keyFeed(keysOf(99_000)); // 1% left the feed
    const result = await runSync(store, provider, { mode: "purge", now: clock });
    expect(result.removed).toBe(1_000);
    expect(store.live()).toBe(99_000);
    // The keys travel as one array parameter, whatever their number.
    expect(Math.max(...store.purgeParams)).toBeLessThan(20);
  });

  it("aborts a purge that would remove more than 5%, removes nothing, and records why", async () => {
    seedLive(store, 1000);
    const { provider } = keyFeed(keysOf(900)); // 10% missing
    await expect(runSync(store, provider, { mode: "purge", now: clock })).rejects.toBeInstanceOf(
      PurgeCapError,
    );
    expect(store.live()).toBe(1000);
    expect(store.runs[0].status).toBe("failed");
    expect(store.runs[0].error).toMatch(new RegExp(`^${PURGE_CAP_PREFIX} 100 of 1000 listings`));
    expect(store.runs[0].error).toContain("--allow-large-purge");
  });

  it("removes past the cap only with the explicit override", async () => {
    seedLive(store, 1000);
    const { provider } = keyFeed(keysOf(900));
    const result = await runSync(store, provider, {
      mode: "purge",
      allowLargePurge: true,
      now: clock,
    });
    expect(result.removed).toBe(100);
    expect(store.live()).toBe(900);
  });

  it("allows up to the cap: 5% of the listings, and never fewer than 25", async () => {
    seedLive(store, 1000);
    const atCap = await runSync(store, keyFeed(keysOf(950)).provider, {
      mode: "purge",
      now: clock,
    });
    expect(atCap.removed).toBe(50);

    const small = new MemoryStore();
    seedLive(small, 100);
    const tiny = await runSync(small, keyFeed(keysOf(75)).provider, { mode: "purge", now: clock });
    expect(tiny.removed).toBe(25);
  });

  it("never purges from a key list that didn't finish before the deadline", async () => {
    seedLive(store, 50_000);
    // 50 pages at 1 s each against a 10 s budget.
    const { provider } = keyFeed(keysOf(50_000));
    await expect(
      runSync(store, provider, { mode: "purge", deadline: START + 10_000, now: clock }),
    ).rejects.toThrow(/didn't finish downloading/);
    expect(store.live()).toBe(50_000);
    expect(store.runs[0].status).toBe("failed");
  });

  it("treats an empty key list as an outage", async () => {
    seedLive(store, 10);
    await expect(
      runSync(store, keyFeed([]).provider, { mode: "purge", now: clock }),
    ).rejects.toThrow(/no listing keys/);
    expect(store.live()).toBe(10);
  });

  it("leaves sales that closed before the window alone", async () => {
    seedLive(store, 100);
    store.listings.set("OLD-SALE", {
      status: "closed",
      closeDate: "2025-01-10",
      modified: 0,
      removed: false,
    });
    store.listings.set("RECENT-SALE", {
      status: "closed",
      closeDate: "2026-06-01",
      modified: 0,
      removed: false,
    });
    const result = await runSync(store, keyFeed(keysOf(100)).provider, {
      mode: "purge",
      now: clock,
    });
    expect(result.removed).toBe(1);
    expect(store.listings.get("RECENT-SALE")!.removed).toBe(true);
    expect(store.listings.get("OLD-SALE")!.removed).toBe(false);
  });

  it("passes liveOnly through to the feed's purge scope, and then compares every stored row", async () => {
    seedLive(store, 100);
    // Closed long ago, from before the live-only filter: out of the usual scope.
    store.listings.set("OLD-SALE", {
      status: "closed",
      closeDate: "2025-01-10",
      modified: 0,
      removed: false,
    });
    const { provider, scopes } = keyFeed(keysOf(100));
    const result = await runSync(store, provider, { mode: "purge", liveOnly: true, now: clock });
    expect(scopes).toEqual([purgeScope(new Date(START), { liveOnly: true })]);
    expect(scopes[0].liveOnly).toBe(true);
    expect(result.removed).toBe(1);
    expect(store.listings.get("OLD-SALE")!.removed).toBe(true);
  });
});

describe("runSync: prune", () => {
  const DAY = 86_400_000;
  const removedRow = (removedAt: number): StoredListing => ({
    status: "active",
    closeDate: null,
    modified: 0,
    removed: true,
    removedAt,
  });

  it("deletes listings removed over a week ago after a successful purge, and reports them", async () => {
    seedLive(store, 100);
    store.listings.set("GONE-8D", removedRow(START - 8 * DAY));
    store.listings.set("GONE-1D", removedRow(START - 1 * DAY));
    // Nothing left the feed: the prune still runs.
    const result = await runSync(store, keyFeed(keysOf(100)).provider, {
      mode: "purge",
      now: clock,
    });
    expect(result).toMatchObject({ status: "succeeded", removed: 0, pruned: 1 });
    expect(store.pruneCalls).toHaveLength(1);
    expect(store.pruneCalls[0].getTime()).toBe(now - 7 * DAY);
    expect(store.listings.has("GONE-8D")).toBe(false);
    expect(store.listings.has("GONE-1D")).toBe(true);
  });

  it("does not prune when the purge cap stops the purge", async () => {
    seedLive(store, 1000);
    store.listings.set("GONE-8D", removedRow(START - 8 * DAY));
    await expect(
      runSync(store, keyFeed(keysOf(900)).provider, { mode: "purge", now: clock }),
    ).rejects.toBeInstanceOf(PurgeCapError);
    expect(store.pruneCalls).toEqual([]);
    expect(store.listings.has("GONE-8D")).toBe(true);
  });

  it("does not prune on an incremental run", async () => {
    const result = await runSync(store, feed(1).provider, { now: clock });
    expect(result.pruned).toBe(0);
    expect(store.pruneCalls).toEqual([]);
  });
});
