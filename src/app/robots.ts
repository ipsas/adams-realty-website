import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

export default function robots(): MetadataRoute.Robots {
  const base = env.NEXT_PUBLIC_SITE_URL;
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/saved", "/account", "/sign-in", "/sign-up"],
    },
    // Neighborhood guides (/areas) publish their own sitemap.
    sitemap: [`${base}/sitemap.xml`, `${base}/areas/sitemap.xml`],
  };
}
