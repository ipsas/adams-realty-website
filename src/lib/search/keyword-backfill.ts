import { and, asc, gt, sql, type SQL } from "drizzle-orm";
import type { Executor } from "@/db";
import { listings } from "@/db/schema";
import { KEYWORD_TSV_VERSION, keywordText, keywordTsv } from "./keyword-text";

/** Below this much time before the deadline, a run doesn't start another statement. */
const MIN_TIME_MS = 5_000;
const UPDATE_BATCH = 500;
/** app_flags key: the KEYWORD_TSV_VERSION every vector was last found built under. */
export const KEYWORD_TSV_VERSION_FLAG = "keyword_tsv_version";

/**
 * A row whose `keyword_tsv` needs (re)writing: built under an older
 * `KEYWORD_TSV_VERSION`, or with no version (no vector: the stale trigger and
 * upsertListings null both). Served by listings_keyword_tsv_ver_idx.
 */
export function staleKeywordTsv(): SQL {
  const version = sql.raw(String(KEYWORD_TSV_VERSION));
  return sql`(${listings.keywordTsvVer} is null or ${listings.keywordTsvVer} < ${version})`;
}

/**
 * Re-vectorizes stale rows (`staleKeywordTsv`: `keyword_tsv` null, or built under
 * an older `KEYWORD_TSV_VERSION`), in batches of `limit` rows read in id order
 * (keyset: each batch reads past the last id the one before read), until a batch
 * reads fewer than `limit`, the deadline is near (a large table is rewritten in a
 * few cron runs, not a day of them) or `batches` batches ran (a caller reporting
 * progress). Each call starts again from the lowest id, so a row skipped by one
 * call is retried by the next. The text is built in JS (`keywordText`: the masker
 * is JS). Writes are statements of at most UPDATE_BATCH rows, each its own short
 * transaction. Only a row unchanged since it was read is written (same
 * `updated_at`, still stale), so a sync write in between wins, and a row another
 * transaction has locked is skipped, not waited on. Until it is rewritten a row
 * keeps its old vector, which search still uses. `updated_at` is left alone: the
 * listing didn't change. Returns how many rows it wrote.
 */
export async function backfillKeywordTsv(
  db: Executor,
  {
    limit = 2000,
    deadline = Infinity,
    batches = Infinity,
  }: { limit?: number; deadline?: number; batches?: number } = {},
): Promise<number> {
  let written = 0;
  let after: string | undefined;
  for (let n = 1; ; n++) {
    const batch = await fillBatch(db, { limit, deadline, after });
    written += batch.written;
    after = batch.last ?? after;
    if (batch.read < limit || batch.stopped || n >= batches) return written;
  }
}

/** Rows whose `keyword_tsv` is stale (`staleKeywordTsv`). */
export async function countStaleKeywordTsv(db: Executor): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(listings)
    .where(staleKeywordTsv());
  return row.n;
}

/**
 * Records in app_flags (`keyword_tsv_version`) that every vector is at
 * `KEYWORD_TSV_VERSION`, only if no stale row remains (checked in the same
 * statement). `set_at` is when that was last found. True when it wrote the flag
 * (no stale row remained).
 */
export async function recordKeywordTsvVersion(db: Executor): Promise<boolean> {
  const result = await db.execute(sql`
    insert into app_flags (key, value, set_at)
    select ${KEYWORD_TSV_VERSION_FLAG}, ${String(KEYWORD_TSV_VERSION)}, now()
    where not exists (select 1 from ${listings} where ${staleKeywordTsv()})
    on conflict (key) do update set value = excluded.value, set_at = excluded.set_at`);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Runs `fill` (a few backfill batches) until `remaining` is 0 or `deadline`
 * passes. A pass that writes nothing while rows remain (locked, or written
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
  { limit, deadline, after }: { limit: number; deadline: number; after?: string },
): Promise<{ read: number; written: number; last?: string; stopped: boolean }> {
  if (deadline - Date.now() < MIN_TIME_MS) return { read: 0, written: 0, stopped: true };
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
    .where(after ? and(gt(listings.id, after), staleKeywordTsv()) : staleKeywordTsv())
    .orderBy(asc(listings.id))
    .limit(limit);
  const last = rows.at(-1)?.id;

  let written = 0;
  for (let i = 0; i < rows.length; i += UPDATE_BATCH) {
    if (deadline - Date.now() < MIN_TIME_MS) {
      return { read: rows.length, written, last, stopped: true };
    }
    const values = rows
      .slice(i, i + UPDATE_BATCH)
      .map((r) => sql`(${r.id}::uuid, ${r.updatedAt}::timestamptz, ${keywordTsv(keywordText(r))})`);
    // Rows locked in id order, a locked one skipped (it stays stale for the next call): a
    // multi-row listing write locking in another order can't deadlock with this one.
    const result = await db.execute(sql`
      with v(id, updated_at, tsv) as (values ${sql.join(values, sql`, `)}),
      locked as (
        select "id" from "listings"
        where "id" in (select id from v) and ${staleKeywordTsv()}
        order by "id" for update skip locked
      )
      update ${listings}
      set "keyword_tsv" = v.tsv, "keyword_tsv_ver" = ${sql.raw(String(KEYWORD_TSV_VERSION))}
      from v join locked using (id)
      where ${listings.id} = v.id and ${listings.updatedAt} = v.updated_at
        and ${staleKeywordTsv()}`);
    written += result.rowCount ?? 0;
  }
  return { read: rows.length, written, last, stopped: false };
}
