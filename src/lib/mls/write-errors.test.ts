import { DrizzleQueryError } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { InvalidRowError } from "@/lib/listings/sanitize";
import {
  describeError,
  errorClass,
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

  it("errorClass names the kind of error, with no values, keys or messages", () => {
    expect(
      errorClass(
        pgError("23505", "duplicate key", {
          table: "listings",
          constraint: "listings_pkey",
          detail: "Key (id)=(12 Main St) already exists.",
        }),
      ),
    ).toBe("Postgres error 23505 (table listings, constraint listings_pkey)");
    const invalid = new InvalidRowError("listing K1", [
      { field: "listPrice", value: 3e9, reason: "out of range for integer" },
    ]);
    expect(errorClass(invalid)).toBe("InvalidRowError (listPrice)");
    expect(errorClass(new TypeError("Cannot read 'x' of jane@example.com"))).toBe("TypeError");
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

  it("redacts unquoted email and street addresses in every message it returns", () => {
    expect(describeError(new Error("no agent for jane.doe+idx@example.co.uk, skipping"))).toBe(
      "Error: no agent for [email], skipping",
    );
    expect(describeError(new Error("geocode failed for 69 Mill Street, Royston"))).toBe(
      "Error: geocode failed for [address], Royston",
    );
    expect(describeError(new Error("bad row 1234 OLD COUNTY HOME RD and 5 Elm Ct."))).toBe(
      "Error: bad row [address] and [address]",
    );
    expect(describeError(new Error("near 210B Lake Hartwell Pkwy at 9 E Main St"))).toBe(
      "Error: near [address] at [address]",
    );
    // Our own and the RESO client's messages, and Postgres ones, too.
    expect(describeError(new SyncError("Listing at 12 Peachtree Rd: ask bob@x.com"))).toBe(
      "Listing at [address]: ask [email]",
    );
    expect(describeError(new Error("RESO feed error for 7 Oak Dr"))).toBe(
      "RESO feed error for [address]",
    );
    expect(
      describeError(pgError("42P01", "relation for a@b.io does not exist", { table: "12 X Way" })),
    ).toBe("relation for [email] does not exist (code: 42P01, table: [address])");
    // Before the length cap, so a cut-off address can't slip through.
    const long = describeError(new Error(`${"x".repeat(180)} at 1234 Long Branch Avenue`));
    expect(long).not.toContain("1234");
    expect(long).toContain("[address]");
  });

  it("redacts addresses in any case, with more suffixes, highways and PO boxes", () => {
    const redacted: [string, string][] = [
      ["1 Elm Trl, 2 Oak Pl. 3 Ash Ter; 4 Fox Run", "[address], [address] [address]; [address]"],
      ["at 5 Big Loop Ext and 9 Shoal Creek Rd", "at [address] and [address]"],
      ["6 Mill Xing #4 / 7 Deep Crk Apt 2B", "[address] / [address]"],
      ["8 Long Trail, 10 Smith Extension, 11 Vista Terrace", "[address], [address], [address]"],
      ["12 Hill Crossing, 13 Rose Place, 14 Bear Creek", "[address], [address], [address]"],
      ["near Highway 17, Hwy 17 and US Highway 29 N", "near [address], [address] and [address]"],
      [
        "via GA-17, State Route 8, SR 8 or US-29.",
        "via [address], [address], [address] or [address].",
      ],
      ["1234 Hwy 17; 0 Highway 17 N; 5 Old Hwy 17 S", "[address]; [address]; [address]"],
      ["PO Box 123, P.O. Box 123, Post Office Box 123", "[address], [address], [address]"],
      ["geocode failed for 12 main st", "geocode failed for [address]"],
      ["geocode failed for 12 main st, Royston", "geocode failed for [address], Royston"],
      ["bad row 1234 old county home rd.", "bad row [address]"],
      ["bad row 12 MAIN street n (skipped)", "bad row [address] (skipped)"],
      ["at 10 Pine Cir NE, Royston", "at [address], Royston"],
      // The house number starts a token, and bare numbers aren't street names.
      ["Key: SALE-123 at 10 Pine Cir", "Key: SALE-123 at [address]"],
      ["rows 5 at 10 Pine Cir", "rows 5 at [address]"],
    ];
    for (const [message, shown] of redacted) {
      expect(describeError(new SyncError(message))).toBe(shown);
    }
  });

  it("redacts mailto links and URL credentials, keeping the host", () => {
    expect(describeError(new SyncError("write to mailto:jane@x.com?subject=hi now"))).toBe(
      "write to [email] now",
    );
    expect(
      describeError(new SyncError("connect postgres://sync:s3cr@t@db.example.com:5432/app")),
    ).toBe("connect postgres://[credentials]@db.example.com:5432/app");
    expect(describeError(new SyncError("GET https://u:p@api.example.com/x failed"))).toBe(
      "GET https://[credentials]@api.example.com/x failed",
    );
  });

  it("redacts phone numbers, SSNs, rural routes and units", () => {
    const redacted: [string, string][] = [
      ["call (706) 555-1234 or 706-555-1234", "call [phone] or [phone]"],
      ["call 706.555.1234, +1 706 555 1234.", "call [phone], [phone]."],
      ["call +1-706-555-1234 or 1-706-555-1234 now", "call [phone] or [phone] now"],
      ["owner ssn 123-45-6789 rejected", "owner ssn [ssn] rejected"],
      ["706 555 1234", "[phone]"],
      ["1 706 555 1234", "[phone]"],
      ["call 706 555 1234 today", "call [phone] today"],
      ["706-555.1234", "[phone]"],
      ["706.555-1234", "[phone]"],
      ["phone:706-555-1234", "phone:[phone]"],
      ["SSN:123-45-6789", "SSN:[ssn]"],
      ["/706-555-1234", "/[phone]"],
      ["GET /owners/706-555-1234?x=1 failed", "GET /owners/[phone]?x=1 failed"],
      ["tel:+1 706 555 1234", "tel:[phone]"],
      ["call 706 555 1234", "call [phone]"],
      ["call (212) 900-0000 or 1 (999) 200 1234", "call [phone] or [phone]"],
      ["call 1-800-200-1234 or 1.212.555.0000", "call [phone] or [phone]"],
      ["call +1 (706) 555-1234", "call [phone]"],
      // After area code 555 the exchange may be any 3 digits.
      ["555 123 4567", "[phone]"],
      ["call 555 123 4567", "call [phone]"],
      ["555-123-4567", "[phone]"],
      ["(555) 123-4567", "[phone]"],
      ["+1 555 123 4567", "[phone]"],
      ["at RR 2 Box 14, Royston", "at [address], Royston"],
      ["at Rural Route 3 Box 7 and rr 4", "at [address] and [address]"],
      ["at RR 2 Box 14 Apt 3", "at [address]"],
      ["moved to apt 4b, then Unit 12", "moved to [unit], then [unit]"],
      ["ste 100 and SUITE 100; Suite #200", "[unit] and [unit]; [unit]"],
      ["at 12 Main St apt 4b and 9 Oak Dr, Suite 100", "at [address] and [address]"],
    ];
    for (const [message, shown] of redacted) {
      expect(describeError(new SyncError(message))).toBe(shown);
    }
    expect(describeError(new Error("no owner at 706-555-1234 apt 4b"))).toBe(
      "Error: no owner at [phone] [unit]",
    );
  });

  it("doesn't take codes, keys, durations or IDs for phones, SSNs or units", () => {
    const kept = [
      "HTTP 503 after 200 ms; SQLSTATE 23505",
      "run at 2026-10-27T02:00:00.000Z took 1500 ms",
      "listing SALE-123 and SALE-123-45-6789 and GAMLS-706-555-1234",
      "unit tests passed; Suite B ran",
      "id 7065551234 and 123456789",
      "cursor 2026-10-27/K000123, version 10.0.0.1:5432",
      "retry in 30 s, 5 min, 2 h",
      // Spaced digits that aren't exactly 3-3-4 ("706 555 1234" alone is a phone).
      "page 706 555 12345 rows; 2 706 555 1234; 706 555 1234 5; 706  555 1234",
      "unit tests",
      "Suite B",
      "10.0.0.1:5432",
      "127.0.0.1:55433",
      "2026-10-27T11:39:52.535Z",
      "2026-10-27 11:39:52",
      "6f1c2a9e-1b2d-4c3e-9f8a-0123456789ab",
      "MLS# 10345678",
      "GAMLS 7012345",
      "$1,250,000",
      "1250000",
      "7065551234",
      "id=7065551234",
      "v1.706.555",
      "listing 706 of 5551 rows",
      "port 5432/tcp",
      // Not a NANP number: an area code starting with 0 or 1.
      "offset 100 200 3000",
      "offset 1 100 200 3000",
      "range 106 555 1234 and 055 555 1234",
      "ids 100-200-3000, 1-155-555-1234",
      "(100) 555-1234 and 1 (055) 555 1234",
      "+1 100 555 1234; +1-155-555-1234; +1 (055) 555-1234",
      // Nor one whose exchange starts with 0 or 1 (unless the area code is 555).
      "offset 200 100 3000",
      "page 706 155 1234",
      "id 123 456 7890",
      "range 706 155 1234 and 206 055 1234",
      "ids 706-100-1234, 706.055.1234",
      "(706) 155-1234 and 1 (706) 055 1234",
      "+1-706-155-1234",
      // A phone-like slug inside a path segment isn't a phone.
      "/listings/706-555-1234-abc",
      "/listings/706-555-1234.html",
    ];
    for (const message of kept) expect(describeError(new SyncError(message))).toBe(message);
  });

  it("doesn't take phrases, codes or keys for addresses", () => {
    const kept = [
      "3 runs the way it should",
      "2 loops completed",
      "5 place holders",
      "HTTP 503 Service Unavailable",
      "SQLSTATE 23505 at 2026-10-27T02:00:00.000Z",
      "listing GAMLS-10345678 and K000123",
      "Royston, GA 30662",
      "tell us 29 times",
      "https://api.example.com/v2/Property?$top=200",
    ];
    for (const message of kept) expect(describeError(new SyncError(message))).toBe(message);
    // The trade-off: a lowercase phrase ending a sentence in a suffix word is redacted.
    expect(describeError(new SyncError("ok after 3 runs the way."))).toBe("ok after [address]");
  });

  it("leaves numbers, statuses, codes, host names and timestamps alone", () => {
    const kept = [
      "RESO request failed (503) for https://api.bridgedataoutput.com/api/v2/OData/gamls/Property",
      "10 of 200 rows rejected on page; not advancing cursor",
      "page at cursor 2026-10-27T02:00:00.000Z/K000123 failed 3 runs in a row",
      "fetched 200 records the way it was asked; 3 Streets",
      "Purge cap: 2650 of 53000 listings would be removed",
      "connect ECONNREFUSED 10.0.0.1:5432 to postgres://sync@db.example.com/app",
    ];
    for (const message of kept) expect(describeError(new SyncError(message))).toBe(message);
    expect(describeError(pgError("57P01", "terminating connection"))).toBe(
      "terminating connection (code: 57P01)",
    );
    expect(describeError(new Error("timeout after 30000 ms"))).toBe(
      "Error: timeout after 30000 ms",
    );
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

  it("never refuses an escalated quarantine: the whole page, past the cap", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const out = await writeIsolated(
      items,
      async () => {
        throw outOfRange();
      },
      vi.fn(),
      { allowRejected: true, maxQuarantined: 0, escalate: true },
    );
    expect(out.failed).toEqual(items);
  });

  it("a refusal carries its counts and the first error's class, without values", async () => {
    const error = await writeIsolated(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        throw outOfRange();
      },
      vi.fn(),
      { allowRejected: true },
    ).catch((e: unknown) => e);
    expect(error).toMatchObject({
      rejected: 10,
      total: 10,
      firstErrorClass: "Postgres error 22003",
    });
  });

  it("skips isolated rows below the thresholds, as before", async () => {
    expect((await rejecting(10, new Set([3]))).failed).toEqual([3]);
    // Under 10 rows, rejected rows are only skipped.
    const small = await rejecting(9, new Set([0, 1, 2, 3, 4]));
    expect(small.failed).toEqual([0, 1, 2, 3, 4]);
    expect(small.results).toEqual([5, 6, 7, 8]);
  });
});
