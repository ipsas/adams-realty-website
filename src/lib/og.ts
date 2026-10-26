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
