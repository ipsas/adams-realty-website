import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import {
  LISTING_SITEMAP_CHUNK_SIZE,
  LISTING_SITEMAP_CHUNKS,
  listingSitemapIds,
  parseChunkId,
} from "@/lib/listings/sitemap-chunks";

// Listing URLs, in fixed chunks at /homes/sitemap/<id>.xml (robots.ts lists
// them all). Rendered per request, so a build never touches the database.
export const dynamic = "force-dynamic";

/** A fixed list: counting listings here would need a database at build time. */
export async function generateSitemaps() {
  return listingSitemapIds();
}

export default async function sitemap(props: {
  id: Promise<string>;
}): Promise<MetadataRoute.Sitemap> {
  const chunk = parseChunkId(await props.id);
  if (chunk === null) return [];
  // Imported here, not at the top: this module (and generateSitemaps) must load without a database.
  const { getListingSitemapChunk } = await import("@/lib/listings/sitemap-query");
  const homes = await getListingSitemapChunk(chunk);
  if (chunk === LISTING_SITEMAP_CHUNKS - 1 && homes.length === LISTING_SITEMAP_CHUNK_SIZE) {
    console.warn(
      "The last listing sitemap chunk is full, so some listings are left out: raise LISTING_SITEMAP_CHUNKS.",
    );
  }
  const base = env.NEXT_PUBLIC_SITE_URL;
  return homes.map((h) => ({
    url: `${base}/homes/${h.slug}`,
    lastModified: h.updatedAt,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }));
}
