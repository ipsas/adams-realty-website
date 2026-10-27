import { asc, sql, type SQL } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, type Executor } from "@/db";
import { listings } from "@/db/schema";
import { closeDb, createSource, insertListings, listing, resetDb } from "@/test/db/helpers";
import { backfillKeywordTsv } from "./keyword-backfill";

// keyword_tsv: written by upsertListings from the stored values, filled by the cron's backfill.

const RANCH = "Charming ranch. Gate code 4521. Living room/kitchen/dining combo.";
const FEATURES = { security: ["Gate code 4455"], appliances: ["Washer/Dryer"] };

const rows = () =>
  db
    .select({
      id: listings.id,
      tsv: sql<string | null>`${listings.keywordTsv}::text`,
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

let source: Awaited<ReturnType<typeof createSource>>;

beforeEach(async () => {
  await resetDb();
  source = await createSource({ slug: "adams", kind: "manual", config: {} });
});

afterAll(closeDb);

describe("upsertListings", () => {
  it("stores keyword_tsv from the listing as shown, codes masked and '/' split", async () => {
    await insertListings(source, [listing(1, { description: RANCH, features: FEATURES })]);
    const [{ tsv }] = await rows();
    expect(tsv).toBeTruthy();
    for (const word of ["'charm'", "'ranch'", "'kitchen'", "'dine'", "'washer'", "'dryer'"]) {
      expect(tsv).toContain(word);
    }
    expect(tsv).not.toContain("4521");
    expect(tsv).not.toContain("4455");
  });

  it("recomputes it on a full update", async () => {
    await insertListings(source, [full(1, { description: RANCH })]);
    await insertListings(source, [full(1, { description: "Bright bungalow." })]);
    const [{ tsv }] = await rows();
    expect(tsv).toContain("'bungalow'");
    expect(tsv).not.toContain("'ranch'");
  });

  it("nulls it on an update that leaves a keyword field to its stored value", async () => {
    await insertListings(source, [full(1, { description: RANCH })]);
    expect((await rows())[0].tsv).toContain("'ranch'");
    // No description in this write: the stored one stays, so this write's text is incomplete.
    const partial = listing(1, { headline: "New headline" });
    expect(partial.description).toBeUndefined();
    await insertListings(source, [partial]);
    const [{ tsv }] = await rows();
    expect(tsv).toBeNull();
    // The backfill then reads the row as stored: the kept description and the new headline.
    expect(await backfillKeywordTsv(db)).toBe(1);
    const [after] = await rows();
    expect(after.tsv).toContain("'ranch'");
    expect(after.tsv).toContain("'headlin'");
  });
});

describe("backfillKeywordTsv", () => {
  const clearAll = () => db.execute(sql`update listings set keyword_tsv = null`);

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
    expect(after.every((r) => r.tsv !== null)).toBe(true);
    expect(after.map((r) => r.updatedAt)).toEqual(before.map((r) => r.updatedAt));
    const ranch = after.find((r) => r.tsv?.includes("'ranch'"));
    expect(ranch?.tsv).not.toContain("4521");
    expect(ranch?.tsv).not.toContain("4455");
    expect(ranch?.tsv).toContain("'dryer'");

    expect(await backfillKeywordTsv(db)).toBe(0);
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

  it("stops when a batch fills none of the rows it read", async () => {
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
    expect(seen.selects).toBe(1);
    expect((await rows()).every((r) => r.tsv === null)).toBe(true);
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

  it("does nothing with too little time before the deadline, or past it", async () => {
    await insertListings(source, [listing(1)]);
    await clearAll();
    expect(await backfillKeywordTsv(db, { deadline: Date.now() + 1000 })).toBe(0);
    expect(await backfillKeywordTsv(db, { deadline: Date.now() - 1000 })).toBe(0);
    expect((await rows())[0].tsv).toBeNull();
  });
});
