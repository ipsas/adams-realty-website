import { and, asc, count, eq, inArray, or } from "drizzle-orm";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { firmAreaCondition } from "@/lib/areas/firm-area";
import { LISTING_SITEMAP_CHUNK_SIZE } from "./sitemap-chunks";
import { publicListing } from "./visibility";

/**
 * The listings the sitemap offers: live (never sold) and indexable in "area"
 * mode (src/lib/listings/indexing.ts), i.e. the firm's own or in its area.
 * Shared by the chunks and the count so the two can't drift.
 */
function sitemapListings() {
  return and(
    publicListing(),
    inArray(listings.status, ["active", "coming_soon", "active_under_contract", "pending"]),
    or(eq(listings.isCompanyListing, true), firmAreaCondition()),
  );
}

/**
 * One listing sitemap chunk: sitemap listings in id order, rows
 * [chunk × size, (chunk + 1) × size). `size` is LISTING_SITEMAP_CHUNK_SIZE
 * except in tests. Chunks are addressed by
 * position, not by a keyset, because each is requested on its own.
 */
export async function getListingSitemapChunk(
  chunk: number,
  size: number = LISTING_SITEMAP_CHUNK_SIZE,
) {
  return db
    .select({ slug: listings.slug, updatedAt: listings.updatedAt })
    .from(listings)
    .where(sitemapListings())
    .orderBy(asc(listings.id))
    .limit(size)
    .offset(chunk * size);
}

/** How many listings the sitemap chunks hold, for robots.txt. */
export async function countSitemapListings(): Promise<number> {
  const [row] = await db.select({ n: count() }).from(listings).where(sitemapListings());
  return row?.n ?? 0;
}

/** Active agent profiles, for the main sitemap. */
export async function getSitemapAgents() {
  return db
    .select({ slug: agents.slug, updatedAt: agents.updatedAt })
    .from(agents)
    .where(eq(agents.isActive, true));
}
