import type { MetadataRoute } from "next";
import { notFound } from "next/navigation";
import { demoDataMode } from "@/lib/demo-mode";
import { env } from "@/lib/env";
import { listingIndexingMode } from "@/lib/listings/indexing";
import {
  LISTING_SITEMAP_CHUNK_SIZE,
  LISTING_SITEMAP_CHUNKS,
  listingSitemapEntries,
  listingSitemapIds,
  parseChunkId,
} from "@/lib/listings/sitemap-chunks";

// Indexable listing URLs (src/lib/listings/indexing.ts), in fixed chunks at
// /homes/sitemap/<id>.xml (robots.ts lists the non-empty ones). Rendered per
// request, so a build never touches the database.
export const dynamic = "force-dynamic";

/** A fixed list: counting listings here would need a database at build time. */
export async function generateSitemaps() {
  return listingSitemapIds();
}

/**
 * An empty chunk is a 404, not an empty <urlset>: notFound() thrown here
 * reaches Next's route handler wrapper (AppRouteRouteModule), which answers
 * any HTTP access fallback error with its status.
 */
export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const chunk = parseChunkId(await props.id);
  // Demo data (src/lib/demo-mode.ts): sample listings are never offered to crawlers.
  // LISTINGS_INDEXING=none: no listing is indexable, so none is offered.
  if (chunk === null || demoDataMode() || listingIndexingMode() === "none") notFound();
  // Imported here, not at the top: this module (and generateSitemaps) must load without a database.
  const { getListingSitemapChunk } = await import("@/lib/listings/sitemap-query");
  const homes = await getListingSitemapChunk(chunk);
  if (!homes.length) notFound();
  if (chunk === LISTING_SITEMAP_CHUNKS - 1 && homes.length === LISTING_SITEMAP_CHUNK_SIZE) {
    console.warn(
      "The last listing sitemap chunk is full, so some listings are left out: raise LISTING_SITEMAP_CHUNKS.",
    );
  }
  return listingSitemapEntries(env.NEXT_PUBLIC_SITE_URL, homes);
}
