import { and, asc, eq, exists, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { dataSources, listings } from "@/db/schema";
import { publicListing } from "./visibility";

/**
 * The listing sources with at least one publicly shown listing (`publicListing`), with what
 * `sourceDisclaimers` (src/lib/mls-copyright.ts) needs. Sources with no active listing (old
 * demo rows, a feed not yet synced) get no disclaimer anywhere.
 */
export async function sourcesWithPublicListings(db: Executor) {
  return db
    .select({
      slug: dataSources.slug,
      disclaimer: dataSources.disclaimer,
      lastSyncedAt: dataSources.lastSyncedAt,
    })
    .from(dataSources)
    .where(
      exists(
        db
          .select({ one: sql`1` })
          .from(listings)
          .where(and(eq(listings.sourceId, dataSources.id), publicListing())),
      ),
    )
    .orderBy(asc(dataSources.slug));
}
