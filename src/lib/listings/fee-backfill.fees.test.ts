import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GAMLS_FEE_FREQUENCY } from "@/lib/mls/reso/mapper";
import { keyBatches, keysFilter, KEYS_PER_REQUEST } from "@/lib/mls/reso/provider";
import {
  BACKFILL_SET,
  backfillUpdate,
  backfillWhere,
  feeAuditScope,
  staleFeeWhere,
} from "./fee-backfill";
import { parseArgs, runBackfill, type BackfillClient } from "./fee-backfill-run";

const dialect = new PgDialect();
const IDS = ["b35e5476-2b15-4c16-908b-020063e6a746", "0c1d2e3f-0000-4000-8000-000000000001"];

/** The scope's text, as every fee WHERE renders it (it always comes first). */
const SCOPE_ONE =
  '("listings"."source_id" in ($1) and "listings"."from_feed" = $2 and "listings"."hoa_fee" > $3)';
const SCOPE_TWO =
  '("listings"."source_id" in ($1, $2) and "listings"."from_feed" = $3 and "listings"."hoa_fee" > $4)';

describe("feeAuditScope (check:fees, the sync audit, the backfill and the heal pass)", () => {
  it("is feed rows with a fee above $0, of the given sources", () => {
    expect(dialect.sqlToQuery(feeAuditScope()).sql).toBe(
      '("listings"."from_feed" = $1 and "listings"."hoa_fee" > $2)',
    );
    expect(dialect.sqlToQuery(feeAuditScope()).params).toEqual([true, 0]);
    expect(dialect.sqlToQuery(feeAuditScope([IDS[0]])).sql).toBe(SCOPE_ONE);
    expect(dialect.sqlToQuery(feeAuditScope(IDS)).sql).toBe(SCOPE_TWO);
    expect(() => feeAuditScope([])).toThrow();
  });

  it("is the same scope text in every fee WHERE", () => {
    const wheres = [
      dialect.sqlToQuery(backfillWhere(IDS)),
      dialect.sqlToQuery(staleFeeWhere(IDS[0])),
      dialect.sqlToQuery(feeAuditScope([IDS[0]])), // SyncStore.auditFees
      dialect.sqlToQuery(feeAuditScope()), // check:fees
    ];
    for (const { sql, params } of wheres) {
      expect(sql).toMatch(/"listings"\."from_feed" = \$\d+ and "listings"\."hoa_fee" > \$\d+/);
      expect(params).toContain(true);
      expect(params).toContain(0);
    }
    expect(wheres[0].sql.startsWith(`(${SCOPE_TWO} and `)).toBe(true);
    expect(wheres[1].sql.startsWith(`(${SCOPE_ONE} and `)).toBe(true);
  });

  it("is what check:fees and the sync audit filter on (no own from_feed/hoa_fee filter)", () => {
    for (const file of ["scripts/check-fees.ts", "src/lib/mls/sync-store.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src).toContain("feeAuditScope(");
      expect(src).not.toMatch(/listings\.fromFeed|gt\(listings\.hoaFee/);
    }
  });
});

describe("backfillWhere", () => {
  it("is exactly the Georgia MLS feed rows, a fee above $0 and no period", () => {
    const { sql, params } = dialect.sqlToQuery(backfillWhere(IDS));
    expect(sql).toBe(`(${SCOPE_TWO} and "listings"."hoa_frequency" is null)`);
    expect(params).toEqual([...IDS, true, 0]);
    expect(sql).not.toMatch(/removed_at|status|updated_at/);
  });

  it("excludes dashboard-entered rows (from_feed = true only)", () => {
    const { sql, params } = dialect.sqlToQuery(backfillWhere(IDS));
    const at = /"listings"\."from_feed" = \$(\d+)/.exec(sql);
    expect(at).not.toBeNull();
    expect(params[Number(at![1]) - 1]).toBe(true);
  });

  it("refuses an empty source list (it would match nothing, or everything)", () => {
    expect(() => backfillWhere([])).toThrow();
  });
});

describe("BACKFILL_SET and the UPDATE", () => {
  it("sets only hoaFrequency, to annually", () => {
    expect(BACKFILL_SET).toEqual({ hoaFrequency: "annually" });
    expect(BACKFILL_SET.hoaFrequency).toBe(GAMLS_FEE_FREQUENCY);
  });

  it("updates hoa_frequency alone (not updated_at) on backfillWhere's rows", () => {
    const { sql, params } = dialect.sqlToQuery(backfillUpdate(IDS));
    expect(sql).toBe(
      'update "listings" set "hoa_frequency" = $1 where (("listings"."source_id" in ($2, $3) and "listings"."from_feed" = $4 and "listings"."hoa_fee" > $5) and "listings"."hoa_frequency" is null)',
    );
    expect(params).toEqual(["annually", ...IDS, true, 0]);
  });
});

describe("staleFeeWhere (the heal pass's rows)", () => {
  it("is this source's live feed rows with a fee and no period", () => {
    const { sql, params } = dialect.sqlToQuery(staleFeeWhere(IDS[0]));
    expect(sql).toBe(
      `(${SCOPE_ONE} and "listings"."removed_at" is null and "listings"."hoa_frequency" is null)`,
    );
    expect(params).toEqual([IDS[0], true, 0]);
  });
});

describe("parseArgs (backfill:hoa-frequency)", () => {
  it("accepts a dry run and --apply with --expect", () => {
    expect(parseArgs([])).toEqual({ apply: false, expect: null });
    expect(parseArgs(["--apply", "--expect=12"])).toEqual({ apply: true, expect: 12 });
    expect(parseArgs(["--expect=0", "--apply"])).toEqual({ apply: true, expect: 0 });
  });

  it("rejects --apply without --expect, bad numbers and unknown arguments", () => {
    expect(parseArgs(["--apply"])).toBe("--apply needs --expect=<the dry run's count>.");
    for (const bad of ["--expect=", "--expect=-1", "--expect=1.5", "--expect=abc", "--expect=1e3"])
      expect(parseArgs(["--apply", bad])).toBe(`Bad ${bad}: expected a whole number.`);
    expect(parseArgs(["--force"])).toBe("Unknown argument --force.");
    expect(parseArgs(["--apply", "--expect=3", "x"])).toBe("Unknown argument x.");
  });
});

describe("runBackfill", () => {
  beforeEach(() => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  /** A client answering each statement by its shape, recording them all. */
  function fakeClient(opts: { matching?: number[]; updated?: number; sources?: string[] } = {}) {
    const statements: string[] = [];
    let counts = 0;
    const client: BackfillClient = {
      async query(text) {
        statements.push(text);
        if (text.includes('from "data_sources"'))
          return { rows: (opts.sources ?? [IDS[0]]).map((id) => ({ id })), rowCount: 1 };
        if (text.startsWith("update")) return { rows: [], rowCount: opts.updated ?? 0 };
        if (text.includes("group by"))
          return {
            rows: [
              { removed: false, status: "active", n: 3 },
              { removed: true, status: "closed", n: 2 },
            ],
            rowCount: 2,
          };
        if (text.includes("count(*)"))
          return { rows: [{ n: opts.matching?.[counts++] ?? 0 }], rowCount: 1 };
        return { rows: [], rowCount: null };
      },
    };
    const kinds = () => statements.map((s) => s.split(" ")[0]);
    return { client, statements, kinds };
  }

  it("dry run: a read-only transaction, rolled back, with no UPDATE or commit", async () => {
    const { client, statements, kinds } = fakeClient();
    expect(await runBackfill(client, { apply: false, expect: null })).toBe(0);
    expect(statements[0]).toBe("begin transaction read only");
    expect(statements.at(-1)).toBe("rollback");
    expect(kinds()).not.toContain("update");
    expect(kinds()).not.toContain("commit");
    expect(console.info).toHaveBeenCalledWith(
      "Georgia MLS listings with an HOA fee and no period: 5",
    );
  });

  it("apply: a recount other than --expect rolls back, with no UPDATE or commit", async () => {
    const { client, kinds } = fakeClient({ matching: [6], updated: 6 });
    expect(await runBackfill(client, { apply: true, expect: 5 })).toBe(1);
    expect(kinds()[0]).toBe("begin");
    expect(kinds().at(-1)).toBe("rollback");
    expect(kinds()).not.toContain("update");
    expect(kinds()).not.toContain("commit");
  });

  it("apply: an UPDATE touching other than --expect rows rolls back, never commits", async () => {
    const { client, kinds } = fakeClient({ matching: [5], updated: 4 });
    expect(await runBackfill(client, { apply: true, expect: 5 })).toBe(1);
    expect(kinds().filter((k) => k === "update")).toHaveLength(1);
    expect(kinds().at(-1)).toBe("rollback");
    expect(kinds()).not.toContain("commit");
  });

  it("apply: matching counts commit exactly once, after exactly one UPDATE", async () => {
    const { client, kinds, statements } = fakeClient({ matching: [5, 0], updated: 5 });
    expect(await runBackfill(client, { apply: true, expect: 5 })).toBe(0);
    expect(kinds().filter((k) => k === "update")).toHaveLength(1);
    expect(kinds().filter((k) => k === "commit")).toHaveLength(1);
    expect(kinds().indexOf("commit")).toBeGreaterThan(kinds().indexOf("update"));
    expect(kinds()).not.toContain("rollback");
    expect(statements.find((s) => s.startsWith("update"))).toBe(
      dialect.sqlToQuery(backfillUpdate([IDS[0]])).sql,
    );
  });

  it("rolls back and rethrows on an error", async () => {
    const statements: string[] = [];
    const client: BackfillClient = {
      async query(text) {
        statements.push(text);
        if (text.includes("data_sources")) throw new Error("boom");
        return { rows: [], rowCount: null };
      },
    };
    await expect(runBackfill(client, { apply: true, expect: 1 })).rejects.toThrow("boom");
    expect(statements.at(-1)).toBe("rollback");
    expect(statements).not.toContain("commit");
  });
});

describe("keysFilter / keyBatches (fetchByKeys)", () => {
  it("ors ListingKey equalities, escaping quotes", () => {
    expect(keysFilter(["A1", "O'Brien"])).toBe("ListingKey eq 'A1' or ListingKey eq 'O''Brien'");
    expect(() => keysFilter([])).toThrow();
  });

  it("batches at most KEYS_PER_REQUEST keys, without duplicates", () => {
    const keys = Array.from({ length: 120 }, (_, i) => `K${i}`);
    const batches = keyBatches([...keys, "K0"]);
    expect(KEYS_PER_REQUEST).toBe(50);
    expect(batches.map((b) => b.length)).toEqual([50, 50, 20]);
    expect(batches.flat()).toEqual(keys);
  });
});
