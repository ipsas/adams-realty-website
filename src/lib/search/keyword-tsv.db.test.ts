import { asc, sql, type SQL } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
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

  it("fills null rows in id order, up to the limit, and leaves updated_at alone", async () => {
    await insertListings(source, [
      listing(1, { description: RANCH, features: FEATURES }),
      listing(2, { description: "Bright bungalow." }),
      listing(3, { description: "Updated duplex." }),
    ]);
    await clearAll();
    const before = await rows();

    expect(await backfillKeywordTsv(db, { limit: 2 })).toBe(2);
    const after = await rows();
    expect(after.map((r) => r.tsv !== null)).toEqual([true, true, false]);
    expect(after.map((r) => r.updatedAt)).toEqual(before.map((r) => r.updatedAt));
    const ranch = after.find((r) => r.tsv?.includes("'ranch'"));
    expect(ranch?.tsv).not.toContain("4521");
    expect(ranch?.tsv).not.toContain("4455");
    expect(ranch?.tsv).toContain("'dryer'");

    expect(await backfillKeywordTsv(db, { limit: 2 })).toBe(1);
    expect((await rows()).every((r) => r.tsv !== null)).toBe(true);
    expect(await backfillKeywordTsv(db)).toBe(0);
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

  it("does nothing with too little time before the deadline", async () => {
    await insertListings(source, [listing(1)]);
    await clearAll();
    expect(await backfillKeywordTsv(db, { deadline: Date.now() + 1000 })).toBe(0);
    expect((await rows())[0].tsv).toBeNull();
  });
});
