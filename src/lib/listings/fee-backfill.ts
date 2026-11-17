import { and, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { listings } from "@/db/schema";
import { GAMLS_FEE_FREQUENCY } from "@/lib/mls/reso/mapper";

/**
 * The one population every HOA fee check and repair works on: feed listings
 * (from_feed = true) with a fee above $0, of `sourceIds` when given (all sources
 * otherwise), removed ones included. Used by `npm run check:fees`, the sync's fee
 * audit (SyncStore.auditFees), the backfill (backfillWhere) and the heal pass
 * (staleFeeWhere), so their counts agree. Dashboard-entered rows (from_feed false)
 * are out on purpose: "every Georgia MLS fee is annual" is a property of the feed's
 * data, not of a fee an agent typed in. Pure (no database), so tests render it.
 */
export function feeAuditScope(sourceIds?: string[]): SQL {
  if (sourceIds && !sourceIds.length) throw new Error("feeAuditScope: empty source id list");
  return and(
    ...(sourceIds ? [inArray(listings.sourceId, sourceIds)] : []),
    eq(listings.fromFeed, true),
    gt(listings.hoaFee, 0),
  )!;
}

/**
 * The backfill's rows (`npm run backfill:hoa-frequency`, scripts/backfill-hoa-frequency.ts):
 * feeAuditScope of the Georgia MLS sources with no stored period. Every Georgia MLS fee
 * is annual (GAMLS_FEE_FREQUENCY), so a null period there is a row the mapper-5 resync
 * didn't reach. Removed feed rows are included on purpose (they're off the site, so
 * harmless, and check:fees counts them). Nothing about status or any other column.
 */
export function backfillWhere(gamlsSourceIds: string[]): SQL {
  if (!gamlsSourceIds.length) throw new Error("backfillWhere: no Georgia MLS source ids");
  return and(feeAuditScope(gamlsSourceIds), isNull(listings.hoaFrequency))!;
}

/** All the backfill sets: the period alone (not updated_at, removed_at or any other column). */
export const BACKFILL_SET = { hoaFrequency: GAMLS_FEE_FREQUENCY } as const;

/**
 * The backfill's single UPDATE: BACKFILL_SET on backfillWhere's rows. Plain SQL, not
 * drizzle's update(), which would also set updated_at (its $onUpdate).
 */
export function backfillUpdate(gamlsSourceIds: string[]): SQL {
  return sql`update ${listings} set ${sql.identifier(listings.hoaFrequency.name)} = ${BACKFILL_SET.hoaFrequency} where ${backfillWhere(gamlsSourceIds)}`;
}

/**
 * The heal pass's rows (SyncStore.staleFeeKeys): feeAuditScope of this source, still
 * on the site (removed_at null), with no period. The store applies it to the Georgia
 * MLS source only.
 */
export function staleFeeWhere(sourceId: string): SQL {
  return and(feeAuditScope([sourceId]), isNull(listings.removedAt), isNull(listings.hoaFrequency))!;
}
