import { asc, eq, sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type Executor } from "@/db";
import { appFlags, listings } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import {
  backfillKeywordTsv,
  countStaleKeywordTsv,
  KEYWORD_TSV_VERSION_FLAG,
  recordKeywordTsvVersion,
} from "./keyword-backfill";
import { KEYWORD_TSV_VERSION } from "./keyword-text";

// keyword_tsv: written by upsertListings from the stored values, with the KEYWORD_TSV_VERSION
// it was built under; stale ones (null, or an older version) rewritten by the cron's backfill.

const RANCH = "Charming ranch. Gate code 4521. Living room/kitchen/dining combo.";
const FEATURES = { security: ["Gate code 4455"], appliances: ["Washer/Dryer"] };

const rows = () =>
  db
    .select({
      id: listings.id,
      key: listings.listingKey,
      tsv: sql<string | null>`${listings.keywordTsv}::text`,
      ver: listings.keywordTsvVer,
      updatedAt: sql<string>`${listings.updatedAt}::text`,
    })
    .from(listings)
    .orderBy(asc(listings.id));

/** A listing that sends every keyword field, as the MLS mapper and the dashboard do. */
const full = (i: number, over: Parameters<typeof listing>[1] = {}) =>
  listing(i, {
    neighborhood: null,
    headline: null,
    propertySubType: null,
    description: null,
    features: {},
    ...over,
  });

const versionFlag = () =>
  db.select().from(appFlags).where(eq(appFlags.key, KEYWORD_TSV_VERSION_FLAG));

let source: Awaited<ReturnType<typeof createSource>>;

beforeEach(async () => {
  await resetDb();
  await db.delete(appFlags).where(eq(appFlags.key, KEYWORD_TSV_VERSION_FLAG));
  source = await createSource({ slug: "adams", kind: "manual", config: {} });
});

afterAll(closeDb);

describe("upsertListings", () => {
  it("stores keyword_tsv from the listing as shown, codes masked and '/' split", async () => {
    await insertListings(source, [listing(1, { description: RANCH, features: FEATURES })]);
    const [{ tsv, ver }] = await rows();
    expect(tsv).toBeTruthy();
    expect(ver).toBe(KEYWORD_TSV_VERSION);
    for (const word of ["'charm'", "'ranch'", "'kitchen'", "'dine'", "'washer'", "'dryer'"]) {
      expect(tsv).toContain(word);
    }
    expect(tsv).not.toContain("4521");
    expect(tsv).not.toContain("4455");
  });

  // The stale trigger leaves it be: the write gives keyword_tsv a new value.
  it("recomputes it on a full update, at the current version", async () => {
    await insertListings(source, [full(1, { description: RANCH })]);
    await db.execute(sql`update listings set keyword_tsv_ver = 1`);
    await insertListings(source, [full(1, { description: "Bright bungalow." })]);
    const [{ tsv, ver }] = await rows();
    expect(tsv).toContain("'bungalow'");
    expect(tsv).not.toContain("'ranch'");
    expect(ver).toBe(KEYWORD_TSV_VERSION);
  });

  it("nulls it and its version on an update that leaves a keyword field to its stored value", async () => {
    await insertListings(source, [full(1, { description: RANCH })]);
    expect((await rows())[0].tsv).toContain("'ranch'");
    // No description in this write: the stored one stays, so this write's text is incomplete.
    const partial = listing(1, { headline: "New headline" });
    expect(partial.description).toBeUndefined();
    await insertListings(source, [partial]);
    const [{ tsv, ver }] = await rows();
    expect(tsv).toBeNull();
    expect(ver).toBeNull();
    // The backfill then reads the row as stored: the kept description and the new headline.
    expect(await backfillKeywordTsv(db)).toBe(1);
    const [after] = await rows();
    expect(after.tsv).toContain("'ranch'");
    expect(after.tsv).toContain("'headlin'");
    expect(after.ver).toBe(KEYWORD_TSV_VERSION);
  });

  // The trigger can't tell the version written again from one left alone (0027): one more
  // backfill rewrite, the same vector.
  it("leaves a row at the current version stale on a full update with new text", async () => {
    await insertListings(source, [full(1, { description: RANCH })]);
    await insertListings(source, [full(1, { description: "Bright bungalow." })]);
    const [{ tsv, ver }] = await rows();
    expect(tsv).toContain("'bungalow'");
    expect(ver).toBeNull();
    expect(await backfillKeywordTsv(db)).toBe(1);
    expect((await rows())[0]).toMatchObject({ tsv, ver: KEYWORD_TSV_VERSION });
  });
});

describe("listings_keyword_tsv_stale trigger", () => {
  const filled = async () => {
    await insertListings(source, [full(1, { description: RANCH })]);
    const [row] = await rows();
    expect(row.tsv).toContain("'ranch'");
    expect(row.ver).toBe(KEYWORD_TSV_VERSION);
    return row;
  };

  it("nulls it and its version on a write that changes a keyword column but not keyword_tsv", async () => {
    const { id } = await filled();
    await db.execute(
      sql`update listings set description = 'Bright bungalow.', updated_at = now() where id = ${id}`,
    );
    const [row] = await rows();
    expect(row.tsv).toBeNull();
    expect(row.ver).toBeNull();
  });

  it("nulls it and its version on an upsert's conflict update that doesn't set keyword_tsv", async () => {
    const { id } = await filled();
    // The row copied as a new insert (every column but id, keyword_tsv and the generated ones),
    // with a new description: it conflicts on (source_id, listing_key).
    const { rows: cols } = await db.execute<{ column_name: string }>(sql`
      select column_name from information_schema.columns
      where table_schema = current_schema() and table_name = 'listings'
        and is_generated = 'NEVER' and column_name not in ('id', 'keyword_tsv')`);
    const names = cols.map((c) => `"${c.column_name}"`);
    const values = cols.map((c) =>
      c.column_name === "description" ? `'Bright bungalow.'` : `"${c.column_name}"`,
    );
    await db.execute(sql`
      insert into listings (${sql.raw(names.join(", "))})
      select ${sql.raw(values.join(", "))} from listings where id = ${id}
      on conflict (source_id, listing_key) do update set description = excluded.description`);
    const [row] = await rows();
    expect(row.id).toBe(id);
    expect(row.tsv).toBeNull();
    expect(row.ver).toBeNull();
  });

  it("keeps it on an update that changes no keyword column, or sets keyword_tsv", async () => {
    const { id } = await filled();
    await db.execute(
      sql`update listings set removed_at = now(), updated_at = now() where id = ${id}`,
    );
    // In the SET list but unchanged.
    await db.execute(sql`update listings set description = description where id = ${id}`);
    expect((await rows())[0]).toMatchObject({ ver: KEYWORD_TSV_VERSION });
    expect((await rows())[0].tsv).toContain("'ranch'");
    // The backfill's keyword_tsv-only write.
    await db.execute(sql`update listings set keyword_tsv = to_tsvector('english', 'cottage')`);
    expect((await rows())[0]).toMatchObject({ tsv: "'cottag':1", ver: KEYWORD_TSV_VERSION });
  });

  it("keeps a vector the write computes along with the new text", async () => {
    const { id } = await filled();
    await db.execute(sql`
      update listings set description = 'Bright bungalow.',
        keyword_tsv = to_tsvector('english', 'Bright bungalow.') where id = ${id}`);
    expect((await rows())[0].tsv).toContain("'bungalow'");
  });

  it("nulls the version, keeping the vector, on a write that sets keyword_tsv but not its version", async () => {
    const { id } = await filled();
    // An upsert from a deploy older than 0026: new text and its unmasked vector, no version.
    const text = "Bright bungalow. Gate code 7788.";
    await db.execute(sql`
      update listings set description = ${text},
        keyword_tsv = to_tsvector('english', ${text}), updated_at = now() where id = ${id}`);
    const [row] = await rows();
    expect(row.tsv).toContain("'7788'");
    expect(row.ver).toBeNull();
    // The backfill then rewrites it, masked.
    expect(await backfillKeywordTsv(db)).toBe(1);
    const [after] = await rows();
    expect(after.tsv).toContain("'bungalow'");
    expect(after.tsv).not.toContain("7788");
    expect(after.ver).toBe(KEYWORD_TSV_VERSION);
    // Its partial write: no vector, still no version.
    await db.execute(sql`update listings set headline = 'New headline', keyword_tsv = null`);
    expect((await rows())[0]).toMatchObject({ tsv: null, ver: null });
  });

  it("keeps a new version written along with the vector", async () => {
    const { id } = await filled();
    await db.execute(
      sql`update listings set keyword_tsv_ver = ${KEYWORD_TSV_VERSION - 1} where id = ${id}`,
    );
    await db.execute(sql`
      update listings set description = 'Bright bungalow.',
        keyword_tsv = to_tsvector('english', 'Bright bungalow.'),
        keyword_tsv_ver = ${KEYWORD_TSV_VERSION} where id = ${id}`);
    const [row] = await rows();
    expect(row.tsv).toContain("'bungalow'");
    expect(row.ver).toBe(KEYWORD_TSV_VERSION);
  });
});

describe("backfillKeywordTsv", () => {
  const clearAll = () =>
    db.execute(sql`update listings set keyword_tsv = null, keyword_tsv_ver = null`);

  /** `db`, counting selects, with `afterExecute` run after each update. */
  const watched = (afterExecute: () => unknown = () => {}) => {
    const seen = { selects: 0 };
    const executor = {
      select: (fields: Parameters<typeof db.select>[0]) => {
        seen.selects++;
        return db.select(fields);
      },
      execute: async (query: SQL) => {
        const result = await db.execute(query);
        await afterExecute();
        return result;
      },
    } as unknown as Executor;
    return { executor, seen };
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fills every null row, batch after batch, and leaves updated_at alone", async () => {
    await insertListings(source, [
      listing(1, { description: RANCH, features: FEATURES }),
      listing(2, { description: "Bright bungalow." }),
      listing(3, { description: "Updated duplex." }),
      listing(4),
      listing(5),
    ]);
    await clearAll();
    const before = await rows();

    const { executor, seen } = watched();
    expect(await backfillKeywordTsv(executor, { limit: 2 })).toBe(5);
    expect(seen.selects).toBe(3);
    const after = await rows();
    expect(after.every((r) => r.tsv !== null && r.ver === KEYWORD_TSV_VERSION)).toBe(true);
    expect(after.map((r) => r.updatedAt)).toEqual(before.map((r) => r.updatedAt));
    const ranch = after.find((r) => r.tsv?.includes("'ranch'"));
    expect(ranch?.tsv).not.toContain("4521");
    expect(ranch?.tsv).not.toContain("4455");
    expect(ranch?.tsv).toContain("'dryer'");

    expect(await backfillKeywordTsv(db)).toBe(0);
    expect(await countStaleKeywordTsv(db)).toBe(0);
  });

  it("rewrites vectors with no or an older version, and leaves current ones alone", async () => {
    await insertListings(source, [
      listing(1, { description: "Charming ranch." }),
      listing(2, { description: "Bright bungalow." }),
      listing(3, { description: "Updated duplex." }),
    ]);
    const before = await rows();
    const [noVersion, older, current] = ["K000001", "K000002", "K000003"].map(
      (key) => before.find((r) => r.key === key)!,
    );
    // Old vectors, still in place: one from before the version, one an older version, and a
    // current one (a stand-in vector, so a rewrite would show).
    await db.execute(sql`
      update listings set keyword_tsv = to_tsvector('english', 'stale'), keyword_tsv_ver = null
      where id = ${noVersion.id}`);
    await db.execute(sql`
      update listings set keyword_tsv = to_tsvector('english', 'stale'),
        keyword_tsv_ver = ${KEYWORD_TSV_VERSION - 1}
      where id = ${older.id}`);
    await db.execute(sql`
      update listings set keyword_tsv = to_tsvector('english', 'kept') where id = ${current.id}`);
    expect(await countStaleKeywordTsv(db)).toBe(2);

    expect(await backfillKeywordTsv(db)).toBe(2);
    const after = await rows();
    const byId = new Map(after.map((r) => [r.id, r]));
    expect(byId.get(noVersion.id)).toMatchObject({ ver: KEYWORD_TSV_VERSION });
    expect(byId.get(noVersion.id)?.tsv).toContain("'ranch'");
    expect(byId.get(older.id)).toMatchObject({ ver: KEYWORD_TSV_VERSION });
    expect(byId.get(older.id)?.tsv).toContain("'bungalow'");
    expect(byId.get(current.id)).toMatchObject({ tsv: "'kept':1", ver: KEYWORD_TSV_VERSION });
    expect([noVersion, older, current].map((r) => byId.get(r.id)?.updatedAt)).toEqual(
      [noVersion, older, current].map((r) => r.updatedAt),
    );
    expect(await countStaleKeywordTsv(db)).toBe(0);
  });

  it("fills lowest id first and starts no batch near the deadline", async () => {
    await insertListings(source, [listing(1), listing(2), listing(3)]);
    await clearAll();
    // The first batch's update uses up the time: the clock jumps to 4 s before the deadline.
    const now = Date.now;
    const deadline = now() + 60_000;
    let skew = 0;
    vi.spyOn(Date, "now").mockImplementation(() => now() + skew);
    const { executor, seen } = watched(() => {
      skew = 56_000;
    });

    expect(await backfillKeywordTsv(executor, { limit: 2, deadline })).toBe(2);
    expect(seen.selects).toBe(1);
    expect((await rows()).map((r) => r.tsv !== null)).toEqual([true, true, false]);
  });

  it("reads past rows it couldn't write, and stops at the end of the table", async () => {
    await insertListings(source, [listing(1), listing(2)]);
    await clearAll();
    // Every row is written again right after each read, so its guard never matches.
    const { executor, seen } = watched();
    const racing = {
      select: (executor as unknown as typeof db).select,
      execute: async (query: SQL) => {
        await db.execute(sql`update listings set updated_at = updated_at + interval '1 second'`);
        return executor.execute(query);
      },
    } as unknown as Executor;

    expect(await backfillKeywordTsv(racing, { limit: 1 })).toBe(0);
    // One row each, then an empty read: the keyset moved on, never rereading a row.
    expect(seen.selects).toBe(3);
    expect((await rows()).every((r) => r.tsv === null && r.ver === null)).toBe(true);
  });

  it("stops after `batches` batches", async () => {
    await insertListings(source, [listing(1), listing(2), listing(3)]);
    await clearAll();
    const { executor, seen } = watched();
    expect(await backfillKeywordTsv(executor, { limit: 1, batches: 2 })).toBe(2);
    expect(seen.selects).toBe(2);
    expect((await rows()).map((r) => r.ver)).toEqual([
      KEYWORD_TSV_VERSION,
      KEYWORD_TSV_VERSION,
      null,
    ]);
  });

  it("skips a row written after it was read", async () => {
    await insertListings(source, [listing(1), listing(2)]);
    await clearAll();
    const [first, second] = await rows();
    // A sync write landing between the backfill's read and its update.
    const racing = {
      select: db.select.bind(db),
      execute: async (query: SQL) => {
        await db.execute(
          sql`update listings set updated_at = updated_at + interval '1 second' where id = ${first.id}`,
        );
        return db.execute(query);
      },
    } as unknown as Executor;

    expect(await backfillKeywordTsv(racing)).toBe(1);
    const after = await rows();
    expect(after.find((r) => r.id === first.id)?.tsv).toBeNull();
    expect(after.find((r) => r.id === second.id)?.tsv).toBeTruthy();
  });

  it("skips a row another transaction has locked, without waiting, moves past it, and retries it on the next call", async () => {
    await insertListings(source, [listing(1), listing(2), listing(3)]);
    await clearAll();
    const [first, second, third] = await rows();
    // A concurrent listing write holding the first row (waiting on it would hang this test).
    const { executor, seen } = watched();
    const written = await db.transaction(async (tx) => {
      await tx.execute(sql`select 1 from listings where id = ${first.id} for update`);
      return backfillKeywordTsv(executor, { limit: 1 });
    });
    expect(written).toBe(2);
    // The keyset went on past the locked row: three one-row batches and an empty read.
    expect(seen.selects).toBe(4);
    const after = new Map((await rows()).map((r) => [r.id, r]));
    expect(after.get(first.id)).toMatchObject({ tsv: null, ver: null });
    expect(after.get(second.id)?.ver).toBe(KEYWORD_TSV_VERSION);
    expect(after.get(third.id)?.ver).toBe(KEYWORD_TSV_VERSION);
    // Unlocked, the next call (from the lowest id again) rewrites it.
    expect(await backfillKeywordTsv(db)).toBe(1);
    expect((await rows()).every((r) => r.ver === KEYWORD_TSV_VERSION)).toBe(true);
  });

  it("does nothing with too little time before the deadline, or past it", async () => {
    await insertListings(source, [listing(1)]);
    await clearAll();
    expect(await backfillKeywordTsv(db, { deadline: Date.now() + 1000 })).toBe(0);
    expect(await backfillKeywordTsv(db, { deadline: Date.now() - 1000 })).toBe(0);
    expect((await rows())[0].tsv).toBeNull();
  });
});

describe("recordKeywordTsvVersion", () => {
  it("records the version only once no stale row remains", async () => {
    await insertListings(source, [listing(1), listing(2)]);
    await db.execute(sql`update listings set keyword_tsv_ver = ${KEYWORD_TSV_VERSION - 1}`);

    expect(await recordKeywordTsvVersion(db)).toBe(false);
    expect(await versionFlag()).toEqual([]);

    expect(await backfillKeywordTsv(db)).toBe(2);
    expect(await recordKeywordTsvVersion(db)).toBe(true);
    const [flag] = await versionFlag();
    expect(flag.value).toBe(String(KEYWORD_TSV_VERSION));
  });

  it("overwrites an older recorded version, and leaves it when a row has gone stale", async () => {
    await insertListings(source, [listing(1)]);
    await db.insert(appFlags).values({ key: KEYWORD_TSV_VERSION_FLAG, value: "1" });
    await db.execute(sql`update listings set keyword_tsv = null, keyword_tsv_ver = null`);
    expect(await recordKeywordTsvVersion(db)).toBe(false);
    expect((await versionFlag())[0].value).toBe("1");

    expect(await backfillKeywordTsv(db)).toBe(1);
    expect(await recordKeywordTsvVersion(db)).toBe(true);
    expect((await versionFlag())[0].value).toBe(String(KEYWORD_TSV_VERSION));
  });
});
