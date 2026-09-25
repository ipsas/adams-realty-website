import { sql } from "drizzle-orm";
import type { Executor } from "@/db";

/**
 * Rebuilds the `places` materialized view (location autocomplete's names and
 * counts; see drizzle/0006_sync_budget_and_places.sql). CONCURRENTLY, so
 * suggestions keep being served from the old rows while it runs (about 0.3 s
 * at statewide scale). Called after every sync that changed listings, after
 * seeding, and after dashboard listing changes.
 */
export async function refreshPlaces(db: Executor): Promise<void> {
  await db.execute(sql`refresh materialized view concurrently places`);
}
