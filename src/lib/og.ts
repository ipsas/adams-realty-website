import type { Metadata } from "next";
import { site } from "@/config/site";

/**
 * The site's default social image. Next merges openGraph shallowly, so a page
 * that sets its own openGraph uses this as its images fallback.
 */
export const OG_DEFAULT_IMAGE = {
  url: "/images/og-default.jpg",
  width: 1200,
  height: 800,
  alt: site.name,
};

/** The root layout's openGraph. */
export const OG_BASE = {
  type: "website",
  siteName: site.name,
  locale: "en_US",
  images: [OG_DEFAULT_IMAGE],
} satisfies Metadata["openGraph"];

/**
 * The layout's openGraph plus og:url, for a page that sets `alternates.canonical`:
 * pass the same URL so og:url equals the canonical. og:title and og:description
 * are left out on purpose: Next fills them from the page's title and description.
 */
export function pageOpenGraph(url: string): Metadata["openGraph"] {
  return { ...OG_BASE, url };
}
