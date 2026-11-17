import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { fakeFeed, FakeStore, pageOf, record, START } from "./fee-sync.test-helpers";
import { OWN_CLOSED_INTERVAL_MS, runSync, STALE_FEE_BATCH } from "./sync-engine";
import type { UpdatesPage } from "./types";

// The sync's fee-period repairs: the own-closed pass on the run that completes a
// remap, and the heal pass that re-fetches stored Georgia MLS fees with no period.

const clock = () => START;
const CURSOR = { modifiedAt: new Date(START - 3_600_000), key: null };

let errors: MockInstance<typeof console.error>;
beforeEach(() => {
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const alerts = () =>
  errors.mock.calls.map((c) => String(c[0])).filter((line) => line.includes("ALERT"));

describe("own-closed pass on a remap", () => {
  it("runs on the run that completes a remap, though not due", async () => {
    const store = new FakeStore();
    store.versions = { done: 4, remappingTo: null };
    store.ownSyncedAt = new Date(START - 60_000); // read a minute ago: not due
    const { provider, ownCalls } = fakeFeed([record("K1")], { own: [record("OWN-1")] });
    const result = await runSync(store, provider, { liveOnly: true, now: clock });
    expect(result.status).toBe("succeeded");
    expect(ownCalls).toHaveLength(1);
    expect(store.writes.map((w) => w.keys)).toEqual([["K1"], ["OWN-1"]]);
    expect(store.finished[0].mapperVersion).toBe(5);
  });

  it("doesn't run on an ordinary incremental run when not due", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.ownSyncedAt = new Date(START - 60_000);
    const { provider, ownCalls } = fakeFeed([record("K1")], { own: [record("OWN-1")] });
    await runSync(store, provider, { liveOnly: true, now: clock });
    expect(ownCalls).toHaveLength(0);
  });

  it("still runs on an ordinary incremental run once due", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.ownSyncedAt = new Date(START - OWN_CLOSED_INTERVAL_MS - 1);
    const { provider, ownCalls } = fakeFeed([record("K1")], { own: [record("OWN-1")] });
    await runSync(store, provider, { liveOnly: true, now: clock });
    expect(ownCalls).toHaveLength(1);
  });
});

describe("fee-period heal pass", () => {
  /** fetchByKeys answering only `has`, one page per call, recording the keys asked for. */
  function byKeys(has: string[], fail?: Error) {
    const asked: string[][] = [];
    const fn = async function* (keys: string[]): AsyncIterable<UpdatesPage> {
      asked.push(keys);
      if (fail) throw fail;
      const items = keys.filter((k) => has.includes(k)).map((k, i) => record(k, i));
      if (items.length) yield pageOf(items);
    };
    return { fn, asked };
  }

  it("re-fetches the stale keys and rewrites them, cursor unchanged", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = ["S1", "S2"];
    const { fn, asked } = byKeys(["S1", "S2"]);
    const result = await runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });
    expect(store.staleCalls[0]).toBe(STALE_FEE_BATCH);
    expect(asked).toEqual([["S1", "S2"]]);
    expect(store.writes).toEqual([{ keys: ["S1", "S2"], cursor: CURSOR, skipUnchanged: false }]);
    expect(store.cursor).toEqual(CURSOR);
    expect(result.status).toBe("succeeded");
    expect(result.fetched).toBe(2);
    expect(result.upserted).toBe(2);
    expect(alerts()).toEqual([]);
  });

  it("writes with the run's own cursor after the feed moved it", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = ["S1"];
    const { fn } = byKeys(["S1"]);
    await runSync(store, fakeFeed([record("K1", 5)], { byKeys: fn }).provider, { now: clock });
    const [main, heal] = store.writes;
    expect(heal).toEqual({ keys: ["S1"], cursor: main.cursor, skipUnchanged: false });
  });

  it("logs one ALERT with the count of keys the feed didn't return", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = ["S1", "S2", "S3"];
    const { fn } = byKeys(["S2"]);
    const result = await runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });
    expect(result.status).toBe("succeeded");
    expect(alerts()).toEqual([
      "[mls] ALERT gamls: 2 stored listings with an HOA fee and no period were not returned " +
        "by the feed; run npm run backfill:hoa-frequency (dry run first)",
    ]);
    expect(alerts()[0]).not.toMatch(/S1|S3/);
  });

  it("logs an ALERT when re-fetched rows still have no period", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = ["S1", "S2"];
    store.healOnWrite = false; // unchanged after the re-fetch
    const { fn } = byKeys(["S1", "S2"]);
    await runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });
    expect(store.amongCalls).toEqual([["S1", "S2"]]);
    expect(alerts()).toEqual([
      "[mls] ALERT gamls: 2 stored listings with an HOA fee still have no period after a re-fetch",
    ]);
  });

  it("a failing fetchByKeys doesn't fail the run, and logs an ALERT", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = ["S1"];
    const { fn } = byKeys([], new Error("feed down"));
    const result = await runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });
    expect(result.status).toBe("succeeded");
    expect(store.finished[0].status).toBe("succeeded");
    expect(store.writes).toEqual([]);
    expect(alerts()).toEqual(["[mls] ALERT gamls: fee period heal pass failed: Error: feed down"]);
    expect(store.cursorRecords).toEqual([]); // the batch is asked for again next run
  });

  it("does nothing without stale keys, or without fetchByKeys", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    const { fn, asked } = byKeys(["S1"]);
    await runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });
    expect(asked).toEqual([]);

    const other = new FakeStore();
    other.cursor = CURSOR;
    other.stale = ["S1"];
    await runSync(other, fakeFeed([]).provider, { now: clock });
    expect(other.writes).toEqual([]);
  });

  it("doesn't run in a purge, or in a full run", async () => {
    for (const mode of ["purge", "full"] as const) {
      const store = new FakeStore();
      store.cursor = CURSOR;
      store.stale = ["S1"];
      const { fn, asked } = byKeys(["S1"]);
      await runSync(store, fakeFeed([record("K1")], { byKeys: fn }).provider, {
        mode,
        now: clock,
      });
      expect(store.staleCalls).toEqual([]);
      expect(asked).toEqual([]);
    }
  });
});

/** K001…K450: zero-padded, so key order is numeric order. */
function keyRange(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => `K${String(from + i).padStart(3, "0")}`);
}

/** fetchByKeys returning every asked key except `missing`, one page, recording each request. */
function feedWithout(missing: string[]) {
  const asked: string[][] = [];
  const fn = async function* (keys: string[]): AsyncIterable<UpdatesPage> {
    asked.push(keys);
    const items = keys.filter((k) => !missing.includes(k)).map((k, i) => record(k, i));
    if (items.length) yield pageOf(items);
  };
  return { fn, asked };
}

const healRun = (store: FakeStore, fn: (keys: string[]) => AsyncIterable<UpdatesPage>) =>
  runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });

describe("heal batch cap", () => {
  it("is 200 keys a pass", () => {
    expect(STALE_FEE_BATCH).toBe(200);
  });

  it("asks the store for exactly 200 keys", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = keyRange(1, 450);
    const { fn, asked } = feedWithout([]);
    await healRun(store, fn);
    expect(store.staleCalls).toEqual([200]);
    expect(asked[0]).toHaveLength(200);
  });
});

describe("heal rotation (feeHealAfter)", () => {
  it("walks 450 stale keys in three runs, past keys the feed never returns, then wraps", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = keyRange(1, 450);
    const missing = ["K001", "K150", "K200", "K201", "K420"]; // never in the feed
    const { fn, asked } = feedWithout(missing);

    await healRun(store, fn);
    expect(asked[0]).toEqual(keyRange(1, 200));
    expect(store.feeCursor).toBe("K200");

    await healRun(store, fn);
    expect(asked[1]).toEqual(keyRange(201, 400));
    expect(store.feeCursor).toBe("K400");

    await healRun(store, fn);
    expect(asked[2]).toEqual(keyRange(401, 450));
    expect(store.feeCursor).toBeNull(); // a short batch: the next pass starts over

    // Only the keys the feed never returned are left; the fourth run starts from the first.
    expect(store.stale).toEqual(missing);
    await healRun(store, fn);
    expect(asked[3]).toEqual(missing);
    expect(store.staleAfters).toEqual([null, "K200", "K400", null]);
    expect(store.cursorRecords).toEqual(["K200", "K400", null, null]);
  });

  it("with nothing healed, the fourth run asks for keys 1-200 again", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = keyRange(1, 450);
    const { fn, asked } = feedWithout(keyRange(1, 450));
    for (let i = 0; i < 4; i++) await healRun(store, fn);
    expect(asked).toEqual([
      keyRange(1, 200),
      keyRange(201, 400),
      keyRange(401, 450),
      keyRange(1, 200),
    ]);
    expect(store.cursorRecords).toEqual(["K200", "K400", null, "K200"]);
  });

  it("wraps to the start in the same run when no key is left after the cursor", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = keyRange(1, 400);
    store.feeCursor = "K400";
    const { fn, asked } = feedWithout(keyRange(1, 400));
    await healRun(store, fn);
    expect(store.staleAfters).toEqual(["K400", null]);
    expect(asked).toEqual([keyRange(1, 200)]);
    expect(store.feeCursor).toBe("K200");
  });

  it("resets the cursor when nothing is stale at all", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.feeCursor = "K200";
    const { fn, asked } = feedWithout([]);
    await healRun(store, fn);
    expect(asked).toEqual([]);
    expect(store.cursorRecords).toEqual([null]);
  });

  it("checks for still-missing periods among this pass's re-fetched keys only", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = keyRange(1, 450);
    store.feeCursor = "K400";
    store.healOnWrite = false;
    const { fn } = feedWithout(["K450"]);
    await healRun(store, fn);
    expect(store.amongCalls).toEqual([keyRange(401, 449)]);
    expect(alerts()).toContain(
      "[mls] ALERT gamls: 49 stored listings with an HOA fee still have no period after a re-fetch",
    );
  });

  it("doesn't move the cursor when the pass runs out of time mid-batch", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.stale = keyRange(1, 450);
    store.feeCursor = "K200";
    let late = false;
    const asked: string[][] = [];
    const fn = async function* (keys: string[]): AsyncIterable<UpdatesPage> {
      asked.push(keys);
      late = true; // the first page takes the rest of the time budget
      yield pageOf(keys.slice(0, 50).map((k, i) => record(k, i)));
      yield pageOf(keys.slice(50).map((k, i) => record(k, i)));
    };
    const result = await runSync(store, fakeFeed([], { byKeys: fn }).provider, {
      now: () => (late ? START + 600_000 : START),
      deadline: START + 60_000,
    });
    expect(result.status).toBe("succeeded");
    expect(asked).toEqual([keyRange(201, 400)]);
    expect(store.writes.map((w) => w.keys.length)).toEqual([50]);
    expect(store.cursorRecords).toEqual([]);
    expect(store.feeCursor).toBe("K200");
  });
});
