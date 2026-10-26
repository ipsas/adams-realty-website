import type { MetadataRoute } from "next";
import { site } from "@/config/site";
import { THEME_COLORS } from "@/lib/theme-script";

// Served as /manifest.webmanifest, outside the preview gate (src/lib/preview-gate.ts).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.name,
    description: site.description,
    start_url: "/",
    display: "browser",
    background_color: THEME_COLORS.light,
    theme_color: THEME_COLORS.light,
    icons: [
      { src: "/icon.svg", type: "image/svg+xml", sizes: "any" },
      { src: "/icons/icon-192.png", type: "image/png", sizes: "192x192" },
      { src: "/icons/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
  };
}
