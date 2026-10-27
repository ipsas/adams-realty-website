import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each public search query runs in a transaction with a statement_timeout; a timeout
// gives an empty result and marks the request's run, anything else still throws.

/** What the next awaited queries give, in order; then `outcome`. */
let outcome: () => Promise<unknown>;
const queue: (() => Promise<unknown>)[] = [];
const executed: string[] = [];
/** Pool connections taken (top-level transactions) and savepoints. */
let transactions = 0;
let savepoints = 0;

/** A query builder: every method chains, awaiting it gives the next outcome. */
function query(): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "then"
          ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
              (queue.shift() ?? outcome)().then(res, rej)
          : () => q,
    },
  );
  return q;
}

const dialect = new PgDialect();
type FakeTx = {
  execute: (s: SQL) => Promise<{ rows: unknown[] }>;
  select: ReturnType<typeof vi.fn>;
  transaction: (run: (t: FakeTx) => Promise<unknown>) => Promise<unknown>;
};
const tx: FakeTx = {
  execute: vi.fn(async (s: SQL) => {
    executed.push(dialect.sqlToQuery(s).sql);
    return { rows: [] };
  }),
  select: vi.fn(() => query()),
  transaction: (run) => {
    savepoints++;
    return run(tx);
  },
};

vi.mock("@/db", () => ({
  db: {
    transaction: (run: (t: typeof tx) => Promise<unknown>) => {
      transactions++;
      return run(tx);
    },
  },
}));
const { countListings, searchListings, searchMapPins, searchRun } = await import("./service");
const { parseSearchParams } = await import("./params");

const criteria = parseSearchParams({ kw: "secret words" });
const scope = {};
/** Postgres's statement_timeout error as drizzle throws it: the pg error as `cause`. */
const timeout = () =>
  Object.assign(new Error("Failed query"), {
    cause: Object.assign(new Error("canceling statement due to statement timeout"), {
      code: "57014",
    }),
  });
const row = { id: "a", status: "active" };

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  executed.length = 0;
  queue.length = 0;
  transactions = 0;
  savepoints = 0;
  tx.select.mockClear();
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());
const lines = () => warn.mock.calls.map((c: unknown[]) => c.join(" "));

describe("public search under a statement timeout", () => {
  it("sets the timeout locally in each query's transaction", async () => {
    outcome = async () => [{ total: 3 }];
    expect(await countListings(criteria, scope)).toBe(3);
    expect(executed).toEqual(["set local statement_timeout = '5s'"]);
  });

  it("runs the results and then the count on one connection", async () => {
    queue.push(
      async () => [row],
      async () => [],
    );
    outcome = async () => [{ total: 30 }];
    const r = await searchListings(criteria, scope);
    expect(r).toMatchObject({ total: 30, pageCount: 2, incomplete: false });
    expect(r.items.map((i) => i.id)).toEqual(["a"]);
    expect(transactions).toBe(1);
    expect(savepoints).toBe(1);
  });

  it("keeps the results of a timed-out count, with no total to page by", async () => {
    // The results, their photos, then the count times out.
    queue.push(
      async () => [row],
      async () => [],
    );
    outcome = () => Promise.reject(timeout());
    const run = searchRun();
    const r = await searchListings(
      parseSearchParams({ kw: "secret words", page: "3" }),
      scope,
      run,
    );
    expect(r.items.map((i) => i.id)).toEqual(["a"]);
    // Not offset + items ("49 results"): unknown, and no page count beyond this page.
    expect(r).toMatchObject({ total: null, page: 3, pageCount: 3, incomplete: true });
    expect(run.timedOut).toBe(true);
    expect(lines()).toEqual(["[search] timeout kind=count"]);
  });

  it("skips the count when the results timed out", async () => {
    outcome = () => Promise.reject(timeout());
    const run = searchRun();
    expect(await searchListings(criteria, scope, run)).toEqual({
      items: [],
      total: null,
      page: 1,
      pageCount: 1,
      incomplete: true,
    });
    expect(tx.select).toHaveBeenCalledTimes(1);
    expect(savepoints).toBe(0);
    expect(run.timedOut).toBe(true);
    expect(lines()).toEqual(["[search] timeout kind=results"]);
  });

  it("after a timeout, starts no other query of the request", async () => {
    outcome = () => Promise.reject(timeout());
    const run = searchRun();
    expect(await searchMapPins(criteria, scope, run)).toEqual([]);
    expect(transactions).toBe(1);
    tx.select.mockClear();
    expect(await searchListings(criteria, scope, run)).toMatchObject({
      items: [],
      total: null,
      incomplete: true,
    });
    expect(await countListings(criteria, scope, run)).toBeNull();
    expect(await searchMapPins(criteria, scope, run)).toEqual([]);
    expect(transactions).toBe(1);
    expect(tx.select).not.toHaveBeenCalled();
    expect(lines()).toEqual(["[search] timeout kind=pins"]);
  });

  it("skips the count when another query of the request timed out meanwhile", async () => {
    const run = searchRun();
    queue.push(async () => {
      run.timedOut = true; // the pins, in parallel
      return [];
    });
    expect(await searchListings(criteria, scope, run)).toMatchObject({
      total: null,
      incomplete: true,
    });
    expect(savepoints).toBe(0);
  });

  it("gives empty results on a timeout, logging the kind but not the search", async () => {
    outcome = () => Promise.reject(timeout());
    // Separate runs: each one times out on its own.
    expect((await searchListings(criteria, scope)).incomplete).toBe(true);
    expect(await countListings(criteria, scope)).toBeNull();
    expect(await searchMapPins(criteria, scope)).toEqual([]);
    expect(executed).toHaveLength(3);
    expect(lines().sort()).toEqual(
      [
        "[search] timeout kind=count",
        "[search] timeout kind=pins",
        "[search] timeout kind=results",
      ].sort(),
    );
    expect(lines().join("\n")).not.toContain("secret");
  });

  it("also knows the pg error itself", async () => {
    outcome = () => Promise.reject(Object.assign(new Error("timeout"), { code: "57014" }));
    expect(await countListings(criteria, scope)).toBeNull();
  });

  it("rethrows any other error", async () => {
    const other = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    outcome = () => Promise.reject(other);
    await expect(countListings(criteria, scope)).rejects.toBe(other);
    await expect(searchMapPins(criteria, scope)).rejects.toBe(other);
    await expect(searchListings(criteria, scope)).rejects.toBe(other);
    // On the count, after the results came back.
    queue.push(async () => []);
    await expect(searchListings(criteria, scope)).rejects.toBe(other);
    expect(warn).not.toHaveBeenCalled();
  });
});
