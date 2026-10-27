import { and, eq, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db, type Executor } from "@/db";
import { dataSources, listings } from "@/db/schema";
import { LISTINGS_TAG } from "@/lib/listings/cache-tags";
import { RESO_MAPPER_VERSION } from "@/lib/mls/reso/mapper";

/**
 * Whether the bedroom-on-main filters may still miss homes: an active RESO feed with
 * listings hasn't caught up to RESO_MAPPER_VERSION (its `config.mapperVersion` is
 * missing or older), so the remap that fills main_level_bedrooms and
 * primary_bedroom_on_main is still underway. The EXISTS uses listings_source_key_idx.
 * Exported for tests; pages use the cached `bedroomOnMainDataUpdating`.
 */
export async function bedroomOnMainDataUpdatingQuery(db: Executor): Promise<boolean> {
  const [row] = await db
    .select({ id: dataSources.id })
    .from(dataSources)
    .where(
      and(
        eq(dataSources.isActive, true),
        eq(dataSources.kind, "reso_web_api"),
        sql`coalesce((${dataSources.config}->>'mapperVersion')::int, 0) < ${RESO_MAPPER_VERSION}`,
        sql`exists (select 1 from ${listings} where ${listings.sourceId} = ${dataSources.id})`,
      ),
    )
    .limit(1);
  return !!row;
}

// Like src/lib/listings/cached.ts: the sync's LISTINGS_TAG revalidation clears it, and
// outside production the cache is skipped.
const cached = unstable_cache(
  () => bedroomOnMainDataUpdatingQuery(db),
  ["bedroom-on-main-updating"],
  {
    tags: [LISTINGS_TAG],
    revalidate: 300,
  },
);

/** The cached check for /homes; false on any error, so the search page never breaks. */
export async function bedroomOnMainDataUpdating(): Promise<boolean> {
  try {
    return await (process.env.NODE_ENV === "production"
      ? cached()
      : bedroomOnMainDataUpdatingQuery(db));
  } catch (e) {
    console.warn("[search] bedroom-on-main updating check failed", e);
    return false;
  }
}
