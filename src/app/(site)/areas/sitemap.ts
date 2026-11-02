import type { MetadataRoute } from "next";
import { guideLastmod, latestLastmod } from "@/lib/areas/stats";
import { demoDataMode } from "@/lib/demo-mode";
import { env } from "@/lib/env";

// Served at /areas/sitemap.xml (robots.ts lists it). Rendered per request so
// demo-data mode is read at run time; demo mode never touches the database.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Demo data (src/lib/demo-mode.ts): the guides show sample listings and stats.
  if (demoDataMode()) return [];
  // Imported here, not at the top: this module must load without a database.
  const { getCachedAreaSummaries } = await import("@/lib/listings/cached");
  const base = env.NEXT_PUBLIC_SITE_URL;
  // Each guide's lastmod is the later of its copy date (Area.updated) and the
  // last change to a listing in it, as the page shows live listing data; the
  // index changes when any guide does.
  const guides = (await getCachedAreaSummaries()).map((summary) => ({
    slug: summary.area.slug,
    lastModified: guideLastmod(summary),
  }));
  return [
    {
      url: `${base}/areas`,
      lastModified: latestLastmod(guides.map((g) => g.lastModified)),
      changeFrequency: "daily",
      priority: 0.7,
    },
    ...guides.map((g) => ({
      url: `${base}/areas/${g.slug}`,
      lastModified: g.lastModified,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
