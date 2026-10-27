import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { InvalidRowError } from "@/lib/listings/sanitize";
import {
  describeError,
  isRowLevelError,
  PageRejectedError,
  redactDetail,
  writeIsolated,
} from "./write-errors";

/** What node-postgres throws, wrapped the way drizzle does. */
function pgError(code: string, message: string, fields: Record<string, string> = {}) {
  const cause = Object.assign(new Error(message), { code, severity: "ERROR", ...fields });
  return new DrizzleQueryError('insert into "listings" …', ["…"], cause);
}

const outOfRange = () => pgError("22003", 'value "2182094640" is out of range for type integer');

describe("describeError", () => {
  it("unwraps drizzle's query error to the Postgres message and its fields, values redacted", () => {
    const e = pgError("23505", 'duplicate key value violates unique constraint "users_email_key"', {
      table: "users",
      constraint: "users_email_key",
      detail: "Key (email)=(jane@example.com) already exists.",
    });
    expect(describeError(e)).toBe(
      'duplicate key value violates unique constraint "users_email_key" (code: 23505, ' +
        "table: users, constraint: users_email_key, detail: Key (email)=([redacted]) already exists.)",
    );
    expect(describeError(e)).not.toContain("Failed query");
    expect(describeError(e)).not.toContain("jane@");
  });

  it("redacts a failing row, keeping code, table, column and constraint", () => {
    const e = pgError(
      "23502",
      'null value in column "city" of relation "listings" violates not-null constraint',
      {
        table: "listings",
        column: "city",
        detail: "Failing row contains (4f1c…, 123 Main St, jane@example.com, null).",
      },
    );
    expect(describeError(e)).toBe(
      'null value in column "city" of relation "listings" violates not-null constraint ' +
        "(code: 23502, table: listings, column: city, detail: Failing row contains ([redacted]).)",
    );
    const check = pgError("23514", 'new row for relation "listings" violates check constraint', {
      constraint: "listings_price_check",
      detail: "Failing row contains (x, 123 Main St).",
    });
    expect(describeError(check)).toContain(
      "constraint: listings_price_check, detail: Failing row contains ([redacted]).",
    );
    expect(describeError(check)).not.toContain("Main St");
  });

  it("redacts foreign-key values and keeps their known wording only", () => {
    const fk = pgError("23503", "insert or update violates foreign key constraint", {
      detail: 'Key (list_agent_id)=(7d0e-…) is not present in table "agents".',
    });
    expect(describeError(fk)).toContain(
      'detail: Key (list_agent_id)=([redacted]) is not present in table "agents".',
    );
    const excl = pgError("23P01", "conflicting key value violates exclusion constraint", {
      detail: "Key (room)=(12) conflicts with existing key (room)=(12).",
    });
    expect(describeError(excl)).toContain("detail: Key (room)=([redacted]))");
  });

  it("drops a detail it doesn't recognize", () => {
    const e = pgError("22P02", "invalid input syntax", {
      table: "listings",
      detail: 'Token "jane@example.com" is invalid.',
    });
    expect(describeError(e)).toBe("invalid input syntax (code: 22P02, table: listings)");
  });

  it("redacts the value a data exception's message quotes", () => {
    expect(
      describeError(pgError("22P02", 'invalid input syntax for type integer: "12 "Main" St"')),
    ).toBe('invalid input syntax for type integer: "[redacted]" (code: 22P02)');
    expect(describeError(outOfRange())).toBe(
      'value "[redacted]" is out of range for type integer (code: 22003)',
    );
  });

  it("describes a Postgres error once, however deeply it's wrapped", () => {
    const inner = outOfRange();
    const wrapped = new Error(describeError(inner), { cause: inner });
    expect(describeError(wrapped)).toBe(describeError(inner));
  });

  it("never shows drizzle's wrapper (SQL and params), even without a Postgres cause", () => {
    const lost = new DrizzleQueryError(
      'insert into "listings" …',
      ["jane@example.com"],
      new Error("Connection terminated unexpectedly"),
    );
    expect(describeError(lost)).toBe("Connection terminated unexpectedly");
  });

  it("passes other errors through", () => {
    expect(describeError(new Error("RESO request failed (503)"))).toBe("RESO request failed (503)");
    expect(describeError("boom")).toBe("boom");
  });
});

describe("redactDetail", () => {
  it("keeps the columns of a key detail, redacts its values, drops other text", () => {
    expect(redactDetail("Key (lower(email::text))=(a@b.co) already exists.")).toBe(
      "Key (lower(email::text))=([redacted]) already exists.",
    );
    expect(redactDetail('Key (slug)=(x) is still referenced from table "leads".')).toBe(
      'Key (slug)=([redacted]) is still referenced from table "leads".',
    );
    expect(redactDetail('Array value must start with "{".')).toBeNull();
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

  /** Writes `n` items, rejecting those in `bad` the way Postgres rejects a statement. */
  const rejecting = (n: number, bad: Set<number>) =>
    writeIsolated(
      Array.from({ length: n }, (_, i) => i),
      async (batch) => {
        if (batch.some((i) => bad.has(i))) throw outOfRange();
        return batch;
      },
      vi.fn(),
    );

  it("fails the page when every row is rejected, however small it is", async () => {
    await expect(rejecting(1, new Set([0]))).rejects.toThrow(
      new PageRejectedError(
        1,
        1,
        'value "[redacted]" is out of range for type integer (code: 22003)',
      ),
    );
    await expect(rejecting(3, new Set([0, 1, 2]))).rejects.toThrow(
      /^3 of 3 rows rejected on page; not advancing cursor\. First error: value "\[redacted\]"/,
    );
  });

  it("fails a page of 10 or more rows when more than half are rejected", async () => {
    await expect(rejecting(10, new Set([0, 2, 4, 6, 8, 9]))).rejects.toThrow(
      /^6 of 10 rows rejected on page/,
    );
    // Exactly half is not more than half.
    const half = await rejecting(10, new Set([0, 2, 4, 6, 8]));
    expect(half.failed).toHaveLength(5);
  });

  it("skips isolated rows below the thresholds, as before", async () => {
    expect((await rejecting(10, new Set([3]))).failed).toEqual([3]);
    // Under 10 rows, only a page rejected whole fails.
    const small = await rejecting(9, new Set([0, 1, 2, 3, 4]));
    expect(small.failed).toEqual([0, 1, 2, 3, 4]);
    expect(small.results).toEqual([5, 6, 7, 8]);
  });
});
