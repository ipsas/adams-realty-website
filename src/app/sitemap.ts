import type { MetadataRoute } from "next";
import { demoDataMode } from "@/lib/demo-mode";
import { env } from "@/lib/env";

// Static pages and agent profiles. Listings are in /homes/sitemap/<id>.xml and
// area guides in /areas/sitemap.xml (robots.ts lists every sitemap). Rendered
// per request so builds never need a database; crawlers fetch it rarely.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_SITE_URL;
  const firmPages: MetadataRoute.Sitemap = [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/sell`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.5 },
    ...["fair-housing", "accessibility", "listing-corrections", "privacy", "terms"].map((page) => ({
      url: `${base}/${page}`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
  ];
  // Demo data (src/lib/demo-mode.ts): no search, places or agent pages (they list sample listings).
  if (demoDataMode()) return firmPages;
  // Imported here so loading this module never needs a database.
  const { getSitemapAgents } = await import("@/lib/listings/sitemap-query");
  const team = await getSitemapAgents();
  return [
    ...firmPages,
    { url: `${base}/homes`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/places`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/agents`, changeFrequency: "monthly", priority: 0.6 },
    ...team.map((a) => ({
      url: `${base}/agents/${a.slug}`,
      lastModified: a.updatedAt,
      priority: 0.5,
    })),
  ];
}
