import type { MetadataRoute } from "next";
import { areas } from "@/config/areas";
import { env } from "@/lib/env";

// Served at /areas/sitemap.xml (robots.ts lists it). Rendered per request so
// builds never need a database (and the data layer is imported lazily, so
// loading this module doesn't either).
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_SITE_URL;
  // The guides themselves are config, so the sitemap still lists them if the
  // database is unreachable; only the freshness dates depend on it.
  const { getCachedAreaSummaries } = await import("@/lib/listings/cached");
  const summaries = await getCachedAreaSummaries().catch(() =>
    areas.map((area) => ({ area, stats: { lastUpdated: null as Date | null } })),
  );
  const latest = summaries.reduce<Date | null>(
    (max, s) =>
      s.stats.lastUpdated && (!max || s.stats.lastUpdated > max) ? s.stats.lastUpdated : max,
    null,
  );
  return [
    {
      url: `${base}/areas`,
      lastModified: latest ?? undefined,
      changeFrequency: "daily",
      priority: 0.7,
    },
    ...summaries.map(({ area, stats }) => ({
      url: `${base}/areas/${area.slug}`,
      lastModified: stats.lastUpdated ?? undefined,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
  ];
}
