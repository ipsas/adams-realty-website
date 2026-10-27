import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Each public search query runs in its own transaction with a statement_timeout; a
// timeout gives an empty result, anything else still throws.

/** What every query in the fake transaction does. */
let outcome: () => Promise<unknown>;
const executed: string[] = [];

/** A query builder: every method chains, awaiting it gives `outcome`. */
function query(): unknown {
  const q: unknown = new Proxy(
    {},
    {
      get: (_, key) =>
        key === "then"
          ? (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => outcome().then(res, rej)
          : () => q,
    },
  );
  return q;
}

const dialect = new PgDialect();
const tx = {
  execute: vi.fn(async (s: SQL) => {
    executed.push(dialect.sqlToQuery(s).sql);
    return { rows: [] };
  }),
  select: vi.fn(() => query()),
};

vi.mock("@/db", () => ({
  db: { transaction: (run: (t: typeof tx) => Promise<unknown>) => run(tx) },
}));
const { countListings, searchListings, searchMapPins } = await import("./service");
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

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  executed.length = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("public search under a statement timeout", () => {
  it("sets the timeout locally in each query's transaction", async () => {
    outcome = async () => [{ total: 3 }];
    expect(await countListings(criteria, scope)).toBe(3);
    expect(executed).toEqual(["set local statement_timeout = '5s'"]);
  });

  it("gives an empty result on a timeout, logging the kind but not the search", async () => {
    outcome = () => Promise.reject(timeout());
    expect(await searchListings(criteria, scope)).toEqual({
      items: [],
      total: 0,
      page: 1,
      pageCount: 1,
    });
    expect(await countListings(criteria, scope)).toBe(0);
    expect(await searchMapPins(criteria, scope)).toEqual([]);
    expect(executed).toHaveLength(4);
    const lines = warn.mock.calls.map((c: unknown[]) => c.join(" "));
    expect(lines.sort()).toEqual(
      [
        "[search] timeout kind=count",
        "[search] timeout kind=count",
        "[search] timeout kind=pins",
        "[search] timeout kind=results",
      ].sort(),
    );
    expect(lines.join("\n")).not.toContain("secret");
  });

  it("also knows the pg error itself", async () => {
    outcome = () => Promise.reject(Object.assign(new Error("timeout"), { code: "57014" }));
    expect(await countListings(criteria, scope)).toBe(0);
  });

  it("rethrows any other error", async () => {
    const other = Object.assign(new Error("relation does not exist"), { code: "42P01" });
    outcome = () => Promise.reject(other);
    await expect(countListings(criteria, scope)).rejects.toBe(other);
    await expect(searchMapPins(criteria, scope)).rejects.toBe(other);
    await expect(searchListings(criteria, scope)).rejects.toBe(other);
    expect(warn).not.toHaveBeenCalled();
  });
});
