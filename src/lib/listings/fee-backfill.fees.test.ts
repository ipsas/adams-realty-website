import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { GAMLS_FEE_FREQUENCY } from "@/lib/mls/reso/mapper";
import { keyBatches, keysFilter, KEYS_PER_REQUEST } from "@/lib/mls/reso/provider";
import { BACKFILL_SET, backfillUpdate, backfillWhere, staleFeeWhere } from "./fee-backfill";

const dialect = new PgDialect();
const IDS = ["b35e5476-2b15-4c16-908b-020063e6a746", "0c1d2e3f-0000-4000-8000-000000000001"];

describe("backfillWhere", () => {
  it("is exactly the Georgia MLS sources, a fee above $0 and no period", () => {
    const { sql, params } = dialect.sqlToQuery(backfillWhere(IDS));
    expect(sql).toBe(
      '("listings"."source_id" in ($1, $2) and ("listings"."hoa_fee" > $3 and "listings"."hoa_frequency" is null))',
    );
    expect(params).toEqual([...IDS, 0]);
    expect(sql).not.toMatch(/removed_at|status|updated_at/);
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
      'update "listings" set "hoa_frequency" = $1 where ("listings"."source_id" in ($2, $3) and ("listings"."hoa_fee" > $4 and "listings"."hoa_frequency" is null))',
    );
    expect(params).toEqual(["annually", ...IDS, 0]);
  });
});

describe("staleFeeWhere (the heal pass's rows)", () => {
  it("is this source's live rows with a fee and no period", () => {
    const { sql, params } = dialect.sqlToQuery(staleFeeWhere(IDS[0]));
    expect(sql).toBe(
      '("listings"."source_id" = $1 and "listings"."removed_at" is null and ("listings"."hoa_fee" > $2 and "listings"."hoa_frequency" is null))',
    );
    expect(params).toEqual([IDS[0], 0]);
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
