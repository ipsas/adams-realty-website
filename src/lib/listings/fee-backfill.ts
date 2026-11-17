import { and, eq, gt, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { listings } from "@/db/schema";
import { GAMLS_FEE_FREQUENCY } from "@/lib/mls/reso/mapper";

/**
 * The rule of `npm run backfill:hoa-frequency` (scripts/backfill-hoa-frequency.ts)
 * and of the sync's fee-period heal pass (SyncStore.staleFeeKeys): a Georgia MLS
 * listing with an HOA fee and no stored period. Every Georgia MLS fee is annual
 * (GAMLS_FEE_FREQUENCY), so a null period there is a row the mapper-5 resync didn't
 * reach. Pure (no database), so tests render it.
 */
const feeWithoutPeriod = () => and(gt(listings.hoaFee, 0), isNull(listings.hoaFrequency))!;

/**
 * The backfill's rows: every listing of the Georgia MLS sources with a fee and no
 * period, removed ones included on purpose (they're off the site, so harmless, and
 * check:fees counts them). Nothing about status or any other column.
 */
export function backfillWhere(gamlsSourceIds: string[]): SQL {
  if (!gamlsSourceIds.length) throw new Error("backfillWhere: no Georgia MLS source ids");
  return and(inArray(listings.sourceId, gamlsSourceIds), feeWithoutPeriod())!;
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
 * The heal pass's rows: this source's listings still on the site (removed_at null)
 * with a fee and no period. The store applies it to the Georgia MLS source only.
 */
export function staleFeeWhere(sourceId: string): SQL {
  return and(eq(listings.sourceId, sourceId), isNull(listings.removedAt), feeWithoutPeriod())!;
}
