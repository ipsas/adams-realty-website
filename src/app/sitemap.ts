import { and, eq, inArray, isNull } from "drizzle-orm";
import type { MetadataRoute } from "next";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { env } from "@/lib/env";

// Rendered per request so builds never need a database; crawlers fetch it rarely.
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = env.NEXT_PUBLIC_SITE_URL;
  const [homes, team] = await Promise.all([
    db
      .select({ slug: listings.slug, updatedAt: listings.updatedAt })
      .from(listings)
      .where(
        and(
          isNull(listings.removedAt),
          inArray(listings.status, ["active", "coming_soon", "active_under_contract", "pending"]),
        ),
      )
      .limit(45_000),
    db
      .select({ slug: agents.slug, updatedAt: agents.updatedAt })
      .from(agents)
      .where(eq(agents.isActive, true)),
  ]);
  return [
    { url: base, changeFrequency: "daily", priority: 1 },
    { url: `${base}/homes`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${base}/sell`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/agents`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/contact`, changeFrequency: "yearly", priority: 0.5 },
    ...["fair-housing", "accessibility", "privacy", "terms"].map((page) => ({
      url: `${base}/${page}`,
      changeFrequency: "yearly" as const,
      priority: 0.2,
    })),
    ...team.map((a) => ({
      url: `${base}/agents/${a.slug}`,
      lastModified: a.updatedAt,
      priority: 0.5,
    })),
    ...homes.map((h) => ({
      url: `${base}/homes/${h.slug}`,
      lastModified: h.updatedAt,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];
}
