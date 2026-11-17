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
    store.staleAnswers = [["S1", "S2"], []];
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
    store.staleAnswers = [["S1"], []];
    const { fn } = byKeys(["S1"]);
    await runSync(store, fakeFeed([record("K1", 5)], { byKeys: fn }).provider, { now: clock });
    const [main, heal] = store.writes;
    expect(heal).toEqual({ keys: ["S1"], cursor: main.cursor, skipUnchanged: false });
  });

  it("logs one ALERT with the count of keys the feed didn't return", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.staleAnswers = [["S1", "S2", "S3"], []];
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
    store.staleAnswers = [["S1", "S2"]]; // unchanged after the re-fetch
    const { fn } = byKeys(["S1", "S2"]);
    await runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });
    expect(alerts()).toEqual([
      "[mls] ALERT gamls: 2 stored listings with an HOA fee still have no period after a re-fetch",
    ]);
  });

  it("a failing fetchByKeys doesn't fail the run", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    store.staleAnswers = [["S1"]];
    const { fn } = byKeys([], new Error("feed down"));
    const result = await runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });
    expect(result.status).toBe("succeeded");
    expect(store.finished[0].status).toBe("succeeded");
    expect(store.writes).toEqual([]);
    expect(errors.mock.calls.flat().join("\n")).toContain("fee period heal pass failed");
  });

  it("does nothing without stale keys, or without fetchByKeys", async () => {
    const store = new FakeStore();
    store.cursor = CURSOR;
    const { fn, asked } = byKeys(["S1"]);
    await runSync(store, fakeFeed([], { byKeys: fn }).provider, { now: clock });
    expect(asked).toEqual([]);

    const other = new FakeStore();
    other.cursor = CURSOR;
    other.staleAnswers = [["S1"]];
    await runSync(other, fakeFeed([]).provider, { now: clock });
    expect(other.writes).toEqual([]);
  });

  it("doesn't run in a purge, or in a full run", async () => {
    for (const mode of ["purge", "full"] as const) {
      const store = new FakeStore();
      store.cursor = CURSOR;
      store.staleAnswers = [["S1"]];
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
