import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { InvalidRowError } from "@/lib/listings/sanitize";
import { describeError, isRowLevelError, writeIsolated } from "./write-errors";

/** What node-postgres throws, wrapped the way drizzle does. */
function pgError(code: string, message: string, fields: Record<string, string> = {}) {
  const cause = Object.assign(new Error(message), { code, severity: "ERROR", ...fields });
  return new DrizzleQueryError('insert into "listings" …', ["…"], cause);
}

const outOfRange = () => pgError("22003", 'value "2182094640" is out of range for type integer');

describe("describeError", () => {
  it("unwraps drizzle's query error to the Postgres message and its fields", () => {
    const e = pgError("23505", "duplicate key value violates unique constraint", {
      table: "listings",
      constraint: "listings_slug_unique",
      detail: "Key (slug)=(x) already exists.",
    });
    expect(describeError(e)).toBe(
      "duplicate key value violates unique constraint (code: 23505, table: listings, " +
        "constraint: listings_slug_unique, detail: Key (slug)=(x) already exists.)",
    );
    expect(describeError(e)).not.toContain("Failed query");
  });

  it("describes a Postgres error once, however deeply it's wrapped", () => {
    const inner = outOfRange();
    const wrapped = new Error(describeError(inner), { cause: inner });
    expect(describeError(wrapped)).toBe(describeError(inner));
    expect(describeError(wrapped)).toBe(
      'value "2182094640" is out of range for type integer (code: 22003)',
    );
  });

  it("passes other errors through", () => {
    expect(describeError(new Error("RESO request failed (503)"))).toBe("RESO request failed (503)");
    expect(describeError("boom")).toBe("boom");
  });
});

describe("isRowLevelError", () => {
  it("is true for data and integrity errors and unstorable rows, false for the rest", () => {
    expect(isRowLevelError(outOfRange())).toBe(true);
    expect(isRowLevelError(pgError("23502", "null value in column"))).toBe(true);
    expect(isRowLevelError(new InvalidRowError("listing K1", []))).toBe(true);
    expect(isRowLevelError(pgError("57P01", "terminating connection"))).toBe(false);
    expect(isRowLevelError(new Error("Connection terminated unexpectedly"))).toBe(false);
  });
});

describe("writeIsolated", () => {
  it("writes a batch that succeeds in one call", async () => {
    const write = vi.fn(async (batch: number[]) => batch.map((n) => n * 10));
    const onRowFailed = vi.fn();
    const out = await writeIsolated([1, 2, 3], write, onRowFailed);
    expect(out).toEqual({ results: [10, 20, 30], failed: [] });
    expect(write).toHaveBeenCalledTimes(1);
    expect(onRowFailed).not.toHaveBeenCalled();
  });

  it("retries a failed batch in parts: writes every good row, skips and reports the bad one", async () => {
    const written: number[] = [];
    const write = vi.fn(async (batch: number[]) => {
      // Like Postgres: one bad row rejects the whole statement, nothing written.
      if (batch.includes(13)) throw outOfRange();
      written.push(...batch);
      return batch;
    });
    const onRowFailed = vi.fn();
    const items = Array.from({ length: 20 }, (_, i) => i);
    const out = await writeIsolated(items, write, onRowFailed);
    expect(out.failed).toEqual([13]);
    expect(written.sort((a, b) => a - b)).toEqual(items.filter((i) => i !== 13));
    expect(out.results).toHaveLength(19);
    expect(onRowFailed).toHaveBeenCalledTimes(1);
    expect(onRowFailed.mock.calls[0][0]).toBe(13);
    expect(describeError(onRowFailed.mock.calls[0][1])).toContain("out of range for type integer");
    // Bisected, not retried row by row.
    expect(write.mock.calls.length).toBeLessThan(items.length);
  });

  it("rethrows an error that isn't a row's fault, writing nothing more", async () => {
    const write = vi.fn(async () => {
      throw pgError("57P01", "terminating connection due to administrator command");
    });
    await expect(writeIsolated([1, 2, 3], write, vi.fn())).rejects.toThrow(DrizzleQueryError);
    expect(write).toHaveBeenCalledTimes(1);
  });
});
