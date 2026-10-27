import { asc, isNull, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { listings } from "@/db/schema";
import { keywordText, keywordTsv } from "./keyword-text";

/** Below this much time before the deadline, a run doesn't start another statement. */
const MIN_TIME_MS = 5_000;
const UPDATE_BATCH = 500;

/**
 * Fills `keyword_tsv` where it is null (rows from before the column, and writes
 * that couldn't compute it), lowest id first, at most `limit` rows. The text is
 * built in JS (`keywordText`: the masker is JS). Only a row unchanged since it
 * was read is written (same `updated_at`, still null), so a sync write in
 * between wins. `updated_at` is left alone: the listing didn't change. Returns
 * how many rows it filled.
 */
export async function backfillKeywordTsv(
  db: Executor,
  { limit = 2000, deadline = Infinity }: { limit?: number; deadline?: number } = {},
): Promise<number> {
  if (deadline - Date.now() < MIN_TIME_MS) return 0;
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
    if (deadline - Date.now() < MIN_TIME_MS) break;
    const values = rows
      .slice(i, i + UPDATE_BATCH)
      .map((r) => sql`(${r.id}::uuid, ${r.updatedAt}::timestamptz, ${keywordTsv(keywordText(r))})`);
    const result = await db.execute(sql`
      update ${listings} set "keyword_tsv" = v.tsv
      from (values ${sql.join(values, sql`, `)}) as v(id, updated_at, tsv)
      where ${listings.id} = v.id and ${listings.updatedAt} = v.updated_at
        and ${listings.keywordTsv} is null`);
    filled += result.rowCount ?? 0;
  }
  return filled;
}
