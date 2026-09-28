import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { LISTING_SITEMAP_CHUNK_SIZE } from "./sitemap-chunks";
import { publicListing } from "./visibility";

/**
 * One listing sitemap chunk: live listings in id order, rows
 * [chunk × size, (chunk + 1) × size). `size` is LISTING_SITEMAP_CHUNK_SIZE
 * except in tests. Chunks are addressed by
 * position, not by a keyset, because each is requested on its own; the
 * covering index listings_live_id_idx makes even the last one an index-only
 * scan (about 10 ms at 53k listings).
 */
export async function getListingSitemapChunk(
  chunk: number,
  size: number = LISTING_SITEMAP_CHUNK_SIZE,
) {
  return db
    .select({ slug: listings.slug, updatedAt: listings.updatedAt })
    .from(listings)
    .where(
      and(
        publicListing(),
        inArray(listings.status, ["active", "coming_soon", "active_under_contract", "pending"]),
      ),
    )
    .orderBy(asc(listings.id))
    .limit(size)
    .offset(chunk * size);
}

/** Active agent profiles, for the main sitemap. */
export async function getSitemapAgents() {
  return db
    .select({ slug: agents.slug, updatedAt: agents.updatedAt })
    .from(agents)
    .where(eq(agents.isActive, true));
}
