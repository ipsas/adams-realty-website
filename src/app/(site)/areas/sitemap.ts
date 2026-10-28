import type { MetadataRoute } from "next";
import { areas } from "@/config/areas";
import { demoDataMode } from "@/lib/demo-mode";
import { env } from "@/lib/env";

// Served at /areas/sitemap.xml (robots.ts lists it). Rendered per request so
// demo-data mode is read at run time; it never needs a database.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Demo data (src/lib/demo-mode.ts): the guides show sample listings and stats.
  if (demoDataMode()) return [];
  const base = env.NEXT_PUBLIC_SITE_URL;
  // Each guide's lastmod is when its copy last changed (Area.updated), not
  // when a listing in it did; the index changes when any guide does.
  // YYYY-MM-DD strings compare in date order.
  const latest = areas.reduce((max, a) => (a.updated > max ? a.updated : max), "");
  return [
    {
      url: `${base}/areas`,
      lastModified: latest || undefined,
      changeFrequency: "daily",
      priority: 0.7,
    },
    ...areas.map((area) => ({
      url: `${base}/areas/${area.slug}`,
      lastModified: area.updated,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
