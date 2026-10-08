import type { MetadataRoute } from "next";
import { DEMO_CONTENT_PATHS, demoDataMode } from "@/lib/demo-mode";
import { env } from "@/lib/env";
import { listingSitemapUrls } from "@/lib/listings/sitemap-chunks";

// Per request, so demo-data mode (src/lib/demo-mode.ts) follows the running
// deployment's environment. Still no database.
export const dynamic = "force-dynamic";

const PRIVATE = ["/dashboard", "/api/", "/saved", "/account", "/sign-in", "/sign-up"];

export default function robots(): MetadataRoute.Robots {
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
    // Pages and agents; the neighborhood guides; listings in fixed chunks
    // (see src/lib/listings/sitemap-chunks.ts). No database needed to list them.
    sitemap: [`${base}/sitemap.xml`, `${base}/areas/sitemap.xml`, ...listingSitemapUrls(base)],
  };
}
