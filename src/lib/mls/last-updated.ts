import { eq } from "drizzle-orm";
import type { Executor } from "@/db";
import { dataSources } from "@/db/schema";
import { GAMLS_SLUG } from "./gamls";

/**
 * When the Georgia MLS feed last synced successfully (data_sources.last_synced_at, set only on
 * successful runs by src/lib/mls/sync-store.ts); null with no gamls row or no sync yet.
 */
export async function gamlsLastSyncedAt(db: Executor): Promise<Date | null> {
  const [row] = await db
    .select({ at: dataSources.lastSyncedAt })
    .from(dataSources)
    .where(eq(dataSources.slug, GAMLS_SLUG))
    .limit(1);
  return row?.at ?? null;
}
