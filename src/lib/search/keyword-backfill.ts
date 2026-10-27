import { asc, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { listings } from "@/db/schema";
import { keywordText, keywordTsv } from "./keyword-text";

/** Below this much time before the deadline, a run doesn't start another statement. */
const MIN_TIME_MS = 5_000;
const UPDATE_BATCH = 500;

/**
 * Fills `keyword_tsv` where it is null (rows from before the column, and writes
 * that couldn't compute it), in batches of `limit` rows, lowest id first, until
 * none are left or the deadline is near (a large table fills in a few cron runs,
 * not a day of them). The text is built in JS (`keywordText`: the masker is JS).
 * Only a row unchanged since it was read is written (same `updated_at`, still
 * null), so a sync write in between wins, and a row another transaction has
 * locked is skipped, not waited on. `updated_at` is left alone: the listing
 * didn't change. At most `batches` batches (a caller reporting progress).
 * Returns how many rows it filled.
 */
export async function backfillKeywordTsv(
  db: Executor,
  {
    limit = 2000,
    deadline = Infinity,
    batches = Infinity,
  }: { limit?: number; deadline?: number; batches?: number } = {},
): Promise<number> {
  let filled = 0;
  for (let n = 1; ; n++) {
    const batch = await fillBatch(db, limit, deadline);
    filled += batch.filled;
    // Done, out of time, or every row read was changed or locked meanwhile (reading them again
    // could loop).
    if (batch.read < limit || batch.stopped || batch.filled === 0 || n >= batches) return filled;
  }
}

/** Rows whose `keyword_tsv` is still null. */
export async function countMissingKeywordTsv(db: Executor): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(isNull(listings.keywordTsv));
  return row.n;
}

/**
 * Runs `fill` (a few backfill batches) until `remaining` is 0 or `deadline`
 * passes. A pass that fills nothing while rows remain (locked, or written
 * meanwhile) is retried after `retryMs`, at most `retries` times in a row.
 * `progress` gets counts only. Used by scripts/keyword-backfill.ts.
 */
export async function backfillUntilDone({
  fill,
  remaining,
  deadline,
  progress = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  retries = 3,
  retryMs = 1000,
}: {
  fill: (deadline: number) => Promise<number>;
  remaining: () => Promise<number>;
  deadline: number;
  progress?: (filled: number, remaining: number) => void;
  sleep?: (ms: number) => Promise<unknown>;
  now?: () => number;
  retries?: number;
  retryMs?: number;
}): Promise<{ filled: number; remaining: number }> {
  let filled = 0;
  let idle = 0;
  for (;;) {
    const n = await fill(deadline);
    filled += n;
    const left = await remaining();
    if (left === 0 || now() >= deadline) return { filled, remaining: left };
    if (n > 0) {
      idle = 0;
      progress(filled, left);
    } else {
      if (++idle > retries) return { filled, remaining: left };
      await sleep(retryMs);
    }
  }
}

async function fillBatch(
  db: Executor,
  limit: number,
  deadline: number,
): Promise<{ read: number; filled: number; stopped: boolean }> {
  if (deadline - Date.now() < MIN_TIME_MS) return { read: 0, filled: 0, stopped: true };
  const rows = await db
    .select({
      id: listings.id,
      // As text: a Date would drop updated_at's microseconds, and the guard below compares it exactly.
      updatedAt: sql<string>`${listings.updatedAt}::text`,
      addressLine1: listings.addressLine1,
      city: listings.city,
      postalCode: listings.postalCode,
      neighborhood: listings.neighborhood,
      mlsNumber: listings.mlsNumber,
      headline: listings.headline,
      propertySubType: listings.propertySubType,
      description: listings.description,
      features: listings.features,
    })
    .from(listings)
    .where(isNull(listings.keywordTsv))
    .orderBy(asc(listings.id))
    .limit(limit);

  let filled = 0;
  for (let i = 0; i < rows.length; i += UPDATE_BATCH) {
    if (deadline - Date.now() < MIN_TIME_MS) return { read: rows.length, filled, stopped: true };
    const values = rows
      .slice(i, i + UPDATE_BATCH)
      .map((r) => sql`(${r.id}::uuid, ${r.updatedAt}::timestamptz, ${keywordTsv(keywordText(r))})`);
    // Rows locked in id order, a locked one skipped (it stays null for the next run): a
    // multi-row listing write locking in another order can't deadlock with this one.
    const result = await db.execute(sql`
      with v(id, updated_at, tsv) as (values ${sql.join(values, sql`, `)}),
      locked as (
        select "id" from "listings"
        where "id" in (select id from v) and "keyword_tsv" is null
        order by "id" for update skip locked
      )
      update ${listings} set "keyword_tsv" = v.tsv
      from v join locked using (id)
      where ${listings.id} = v.id and ${listings.updatedAt} = v.updated_at
        and ${listings.keywordTsv} is null`);
    filled += result.rowCount ?? 0;
  }
  return { read: rows.length, filled, stopped: false };
}
