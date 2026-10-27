import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { InvalidRowError } from "@/lib/listings/sanitize";
import {
  describeError,
  isRowLevelError,
  MAX_ERROR_LENGTH,
  PageRejectedError,
  QuarantineRefusedError,
  redactDetail,
  SyncError,
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
    expect(describeError(lost)).toBe("Error: Connection terminated unexpectedly");
  });

  it("passes our own errors through", () => {
    expect(
      describeError(new Error("RESO request failed (503) for https://x/?access_token=***")),
    ).toBe("RESO request failed (503) for https://x/?access_token=***");
    const own = new SyncError("Purge stopped: run `npm run mls:sync -- --purge`.");
    expect(describeError(own)).toBe("Purge stopped: run `npm run mls:sync -- --purge`.");
    const rejected = new PageRejectedError(6, 10, 'value "[redacted]" is out of range');
    expect(describeError(rejected)).toBe(rejected.message);
    const invalid = new InvalidRowError("listing K1", [
      { field: "listPrice", value: 3e9, reason: "out of range for integer" },
    ]);
    expect(describeError(invalid)).toBe(invalid.message);
    expect(describeError("boom")).toBe("boom");
  });

  it("keeps an encoding error's encoding, not its bytes (22021)", () => {
    const e = pgError("22021", 'invalid byte sequence for encoding "UTF8": 0x4a 0x61');
    expect(describeError(e)).toBe(
      'invalid byte sequence for encoding "UTF8": [redacted] (code: 22021)',
    );
    expect(describeError(e)).not.toContain("0x4a");
  });

  it("never shows a raise_exception's own text (P0001)", () => {
    const e = pgError("P0001", "listing 12 Main St belongs to jane@example.com");
    expect(describeError(e)).toBe("Database raised an exception (code: P0001)");
  });

  it("keeps a check violation's standard wording only (23514)", () => {
    const standard = pgError(
      "23514",
      'new row for relation "listings" violates check constraint "listings_price_check"',
    );
    expect(describeError(standard)).toBe(
      'new row for relation "listings" violates check constraint "listings_price_check" (code: 23514)',
    );
    const domain = pgError("23514", 'value for domain zip violates check constraint "zip_check"');
    expect(describeError(domain)).toBe("Check constraint violated (code: 23514)");
    const odd = pgError(
      "23514",
      'new row for relation "x" violates check constraint "y": 12 Main St',
    );
    expect(describeError(odd)).toBe("Check constraint violated (code: 23514)");
  });

  it("doesn't name the user of a failed login (28P01)", () => {
    const e = pgError("28P01", 'password authentication failed for user "neondb_owner"');
    expect(describeError(e)).toBe(
      'password authentication failed for user "[redacted]" (code: 28P01)',
    );
  });

  it("redacts quoted values in other errors, keeping their name, and caps their length", () => {
    const type = new DrizzleQueryError(
      "select …",
      [],
      new TypeError("Cannot read properties of undefined (reading 'jane@example.com')"),
    );
    expect(describeError(type)).toBe(
      "TypeError: Cannot read properties of undefined (reading '[redacted]')",
    );
    expect(describeError(new Error('bad value "12 Main St" in `addr`'))).toBe(
      'Error: bad value "[redacted]" in `[redacted]`',
    );
    // An apostrophe isn't a quote.
    expect(describeError(new Error("feed doesn't answer"))).toBe("Error: feed doesn't answer");
    const long = describeError(new Error("x".repeat(500)));
    expect(long).toHaveLength(MAX_ERROR_LENGTH);
    expect(long.endsWith("…")).toBe(true);
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

  it("fails a page of 10 or more rows when every row is rejected", async () => {
    await expect(rejecting(10, new Set(Array.from({ length: 10 }, (_, i) => i)))).rejects.toThrow(
      new PageRejectedError(
        10,
        10,
        'value "[redacted]" is out of range for type integer (code: 22003)',
      ),
    );
  });

  it("never fails a page under 10 rows, even when every row is rejected", async () => {
    const one = await rejecting(1, new Set([0]));
    expect(one).toEqual({ results: [], failed: [0] });
    const three = await rejecting(3, new Set([0, 1, 2]));
    expect(three).toEqual({ results: [], failed: [0, 1, 2] });
  });

  it("fails a page of 10 or more rows when more than half are rejected", async () => {
    await expect(rejecting(10, new Set([0, 2, 4, 6, 8, 9]))).rejects.toThrow(
      /^6 of 10 rows rejected on page/,
    );
    // Exactly half is not more than half.
    const half = await rejecting(10, new Set([0, 2, 4, 6, 8]));
    expect(half.failed).toHaveLength(5);
  });

  it("reports skipped rows only once the page is known not to fail", async () => {
    const onRowFailed = vi.fn();
    const write = async (batch: number[]) => {
      if (batch.some((i) => i < 6)) throw outOfRange();
      return batch;
    };
    const items = Array.from({ length: 10 }, (_, i) => i);
    await expect(writeIsolated(items, write, onRowFailed)).rejects.toThrow(PageRejectedError);
    expect(onRowFailed).not.toHaveBeenCalled();
    // Quarantining the page: it doesn't fail, and every rejected row is reported.
    const out = await writeIsolated(items, write, onRowFailed, { allowRejected: true });
    expect(out).toEqual({ results: [6, 7, 8, 9], failed: [0, 1, 2, 3, 4, 5] });
    expect(onRowFailed.mock.calls.map((c) => c[0])).toEqual([0, 1, 2, 3, 4, 5]);
    expect(describeError(onRowFailed.mock.calls[0][1])).toContain("out of range");
  });

  it("refuses to quarantine a page of 10 or more rows when every row is rejected", async () => {
    const onRowFailed = vi.fn();
    const all = writeIsolated(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        throw outOfRange();
      },
      onRowFailed,
      { allowRejected: true },
    );
    await expect(all).rejects.toThrow(QuarantineRefusedError);
    await expect(all).rejects.toThrow(
      /^10 of 10 rows rejected on a page due for quarantine; the whole page/,
    );
    expect(onRowFailed).not.toHaveBeenCalled();
    // A smaller page is quarantined even when all of it is rejected.
    const small = await writeIsolated(
      [0, 1, 2],
      async () => {
        throw outOfRange();
      },
      vi.fn(),
      { allowRejected: true },
    );
    expect(small.failed).toEqual([0, 1, 2]);
  });

  it("refuses to quarantine more rows than the run has left, and allows exactly that many", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const write = async (batch: number[]) => {
      if (batch.some((i) => i < 6)) throw outOfRange();
      return batch;
    };
    const onRowFailed = vi.fn();
    await expect(
      writeIsolated(items, write, onRowFailed, { allowRejected: true, maxQuarantined: 5 }),
    ).rejects.toThrow(
      /^6 of 10 rows .*more than the run's quarantine cap allows \(5 left of 150\)/,
    );
    expect(onRowFailed).not.toHaveBeenCalled();
    const out = await writeIsolated(items, write, vi.fn(), {
      allowRejected: true,
      maxQuarantined: 6,
    });
    expect(out.failed).toHaveLength(6);
    // Without allowRejected the cap plays no part: the page fails as rejected.
    await expect(writeIsolated(items, write, vi.fn(), { maxQuarantined: 0 })).rejects.toThrow(
      PageRejectedError,
    );
  });

  it("skips isolated rows below the thresholds, as before", async () => {
    expect((await rejecting(10, new Set([3]))).failed).toEqual([3]);
    // Under 10 rows, rejected rows are only skipped.
    const small = await rejecting(9, new Set([0, 1, 2, 3, 4]));
    expect(small.failed).toEqual([0, 1, 2, 3, 4]);
    expect(small.results).toEqual([5, 6, 7, 8]);
  });
});
