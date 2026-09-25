import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { LISTING_SITEMAP_CHUNK_SIZE } from "./sitemap-chunks";

/**
 * One listing sitemap chunk: live listings in id order, rows
 * [chunk × CHUNK_SIZE, (chunk + 1) × CHUNK_SIZE). Chunks are addressed by
 * position, not by a keyset, because each is requested on its own; the
 * covering index listings_live_id_idx makes even the last one an index-only
 * scan (about 10 ms at 53k listings).
 */
export async function getListingSitemapChunk(chunk: number) {
  return db
    .select({ slug: listings.slug, updatedAt: listings.updatedAt })
    .from(listings)
    .where(
      and(
        isNull(listings.removedAt),
        inArray(listings.status, ["active", "coming_soon", "active_under_contract", "pending"]),
      ),
    )
    .orderBy(asc(listings.id))
    .limit(LISTING_SITEMAP_CHUNK_SIZE)
    .offset(chunk * LISTING_SITEMAP_CHUNK_SIZE);
}

/** Active agent profiles, for the main sitemap. */
export async function getSitemapAgents() {
  return db
    .select({ slug: agents.slug, updatedAt: agents.updatedAt })
    .from(agents)
    .where(eq(agents.isActive, true));
}
