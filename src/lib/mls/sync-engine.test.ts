import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, it } from "vitest";
import { purgeCountQuery, purgeScope, purgeWhere } from "./purge";
import {
  PURGE_CAP_PREFIX,
  PurgeCapError,
  runSync,
  type PageOutcome,
  type RunOutcome,
  type SyncCounts,
  type SyncMode,
  type SyncStore,
} from "./sync-engine";
import type { ListingProvider, MapResult, NormalizedListing, PurgeScope } from "./types";

// The engine against an in-memory store and a fake feed on a fake clock:
// every page "takes" PAGE_MS, so a 300 s function is simulated instantly.

const PAGE_MS = 10_000;
const START = Date.parse("2026-09-25T09:00:00Z");
const SOURCE_ID = "b35e5476-2b15-4c16-908b-020063e6a746";
/** Postgres rejects a statement with more bind parameters than this. */
const PG_MAX_PARAMS = 65_535;

let now = START;
const clock = () => now;

type StoredListing = {
  status: NormalizedListing["status"];
  closeDate: string | null;
  modified: number;
  removed: boolean;
};

type Run = {
  id: string;
  mode: SyncMode;
  status: RunOutcome["status"] | "running";
  heartbeat: number;
  counts?: SyncCounts;
  cursor?: Date | null;
  error?: string;
};

class MemoryStore implements SyncStore {
  listings = new Map<string, StoredListing>();
  cursor: Date | null = null;
  runs: Run[] = [];
  purgeParams: number[] = [];

  async beginRun(mode: SyncMode, staleBefore: Date) {
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

  async savedCursor() {
    return this.cursor;
  }

  async writePage(page: MapResult[], cursor: Date | null): Promise<PageOutcome> {
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
        continue;
      }
      const n = item.listing;
      const modified = n.sourceModifiedAt!.getTime();
      const prev = this.listings.get(n.listingKey);
      if (prev && !prev.removed && prev.modified === modified) {
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
    this.cursor = cursor;
    return { upserted, unchanged, removed, mediaRowsWritten: 0 };
  }

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
        (["active", "coming_soon", "active_under_contract", "pending"].includes(l.status) ||
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
    for (const [, l] of missing) l.removed = true;
    return missing.length;
  }

  async finishRun(runId: string, outcome: RunOutcome) {
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

/** A feed of `pages` × `perPage` records; each page takes PAGE_MS on the fake clock. */
function feed(pages: number, perPage = 200) {
  const records = Array.from({ length: pages * perPage }, (_, i) => record(i));
  const calls: Array<Date | null> = [];
  const provider: ListingProvider = {
    async *fetchUpdates(since) {
      calls.push(since);
      const due = records.filter((r) => r.ok && (!since || r.listing.sourceModifiedAt! >= since));
      for (let i = 0; i < due.length; i += perPage) {
        now += PAGE_MS;
        yield due.slice(i, i + perPage);
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
    // The cursor is the newest record written, saved with the page.
    const lastWritten = records[first.upserted - 1];
    expect(lastWritten.ok && store.cursor).toEqual(
      lastWritten.ok ? lastWritten.listing.sourceModifiedAt : null,
    );
    expect(store.runs[0].cursor).toEqual(store.cursor);

    const second = await runSync(store, provider, { deadline: now + 1_000_000, now: clock });
    expect(calls[1]).toEqual(store.runs[0].cursor);
    expect(second.status).toBe("succeeded");
    // Resumed, not restarted: only the boundary record (`ge` cursor) is seen again.
    expect(second.upserted).toBe(10_000 - first.upserted);
    expect(second.unchanged).toBe(1);
    expect(store.live()).toBe(10_000);
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

  it("leaves a run that is still heartbeating alone and does nothing", async () => {
    store.runs.push({ id: "live", mode: "full", status: "running", heartbeat: START - 5_000 });
    const { provider, calls } = feed(1);
    const result = await runSync(store, provider, { now: clock });
    expect(result).toMatchObject({ status: "skipped", runId: null, changed: false });
    expect(calls).toHaveLength(0);
    expect(store.runs).toHaveLength(1);
    expect(store.runs[0].status).toBe("running");
  });

  it("a full run ignores the saved cursor", async () => {
    store.cursor = new Date(START);
    const { provider, calls } = feed(2);
    const result = await runSync(store, provider, { mode: "full", now: clock });
    expect(calls).toEqual([null]);
    expect(result.upserted).toBe(400);
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

describe("runSync: purge", () => {
  it("is purge-only: never fetches updates, removes what left the feed, keeps the cursor", async () => {
    seedLive(store, 1000);
    store.cursor = new Date(START - 60_000);
    const { provider, scopes } = keyFeed(keysOf(980)); // 20 listings (2%) left the feed
    const result = await runSync(store, provider, { mode: "purge", now: clock });
    expect(result).toMatchObject({ status: "succeeded", mode: "purge", removed: 20, fetched: 980 });
    expect(store.live()).toBe(980);
    expect(store.cursor).toEqual(new Date(START - 60_000));
    // The feed is asked for the scope the site keeps: live, plus sales closed in the last year.
    expect(scopes).toEqual([purgeScope(new Date(START))]);
    expect(scopes[0].closedSince).toBe("2025-09-25");
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
});
