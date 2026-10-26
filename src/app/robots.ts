import type { MetadataRoute } from "next";
import { DEMO_CONTENT_PATHS, demoDataMode } from "@/lib/demo-mode";
import { env } from "@/lib/env";
import { listingIndexingMode } from "@/lib/listings/indexing";
import { listingSitemapUrls } from "@/lib/listings/sitemap-chunks";
import { previewPassword } from "@/lib/preview-gate";

// Per request, so the preview gate (src/lib/preview-gate.ts) and demo-data mode
// (src/lib/demo-mode.ts) follow the running deployment's environment. Loads without a
// database; only the listing count queries one, per request.
export const dynamic = "force-dynamic";

const PRIVATE = ["/dashboard", "/api/", "/saved", "/account", "/sign-in", "/sign-up"];

export default async function robots(): Promise<MetadataRoute.Robots> {
  // Preview gate: the whole site is private until launch, so nothing is crawled, and no
  // sitemaps are listed (they answer 401 while gated).
  if (previewPassword()) return { rules: { userAgent: "*", disallow: "/" } };
  const base = env.NEXT_PUBLIC_SITE_URL;
  // Demo data: keep crawlers off the sample listings and the guides, places and agent
  // pages that show them, and list only the main sitemap (which leaves them out too).
  if (demoDataMode()) {
    return {
      rules: { userAgent: "*", allow: "/", disallow: [...PRIVATE, ...DEMO_CONTENT_PATHS] },
      sitemap: [`${base}/sitemap.xml`],
    };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: PRIVATE },
    // Pages and agents; the neighborhood guides; the listing chunks that hold
    // indexable listings (src/lib/listings/indexing.ts, sitemap-chunks.ts).
    sitemap: [
      `${base}/sitemap.xml`,
      `${base}/areas/sitemap.xml`,
      ...listingSitemapUrls(base, await indexableListingCount()),
    ],
  };
}

/**
 * How many listings the sitemap chunks hold: none in "none" mode, and none
 * (never every chunk) when the database can't be reached.
 */
async function indexableListingCount(): Promise<number> {
  if (listingIndexingMode() === "none") return 0;
  try {
    // Imported here, not at the top: this module must load without a database.
    const { countSitemapListings } = await import("@/lib/listings/sitemap-query");
    return await countSitemapListings();
  } catch (err) {
    console.error("robots.txt: couldn't count sitemap listings, listing no listing sitemaps.", err);
    return 0;
  }
}
