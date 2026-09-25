import type { MetadataRoute } from "next";
import { env } from "@/lib/env";
import { listingSitemapUrls } from "@/lib/listings/sitemap-chunks";

export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_SITE_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/saved", "/account", "/sign-in", "/sign-up"],
    },
    // Pages and agents; the neighborhood guides; listings in fixed chunks
    // (see src/lib/listings/sitemap-chunks.ts). No database needed to list them.
    sitemap: [`${base}/sitemap.xml`, `${base}/areas/sitemap.xml`, ...listingSitemapUrls(base)],
  };
}
