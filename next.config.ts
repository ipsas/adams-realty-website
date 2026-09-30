import type { NextConfig } from "next";
import {
  PHOTO_CACHE_SECONDS,
  PHOTO_QUALITY,
  PHOTO_WIDTHS,
  THUMB_WIDTHS,
} from "./src/config/images";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const isProduction = process.env.NODE_ENV === "production";
/**
 * The fake MLS photo host the tests use (e2e/fixtures/photo-host.mjs) is on 127.0.0.1, which
 * the optimizer refuses by default (SSRF protection). Allow loopback in development, and in a
 * local `next start` only when E2E_PHOTO_HOST says so. Never set E2E_PHOTO_HOST on Vercel.
 */
const allowFixtureHost = !isProduction || !!process.env.E2E_PHOTO_HOST;

const nextConfig: NextConfig = {
  poweredByHeader: false,
  /**
   * Listing photos from Georgia MLS and from links agents paste can be on any host, and
   * arrive full size, so any http(s) host may be resized (src/lib/photos.ts decides which
   * photos go through here: everything except a CDN that resizes on its own). Only the widths
   * and the one quality in src/config/images.ts are made, and only WebP (or the original
   * format for clients that don't accept it). See ARCHITECTURE.md → "Photos".
   */
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
      { protocol: "http", hostname: "**" },
    ],
    deviceSizes: [...PHOTO_WIDTHS],
    imageSizes: [...THUMB_WIDTHS],
    qualities: [PHOTO_QUALITY],
    formats: ["image/webp"],
    minimumCacheTTL: PHOTO_CACHE_SECONDS,
    // MLS originals are a few MB; nothing legitimate is near this.
    maximumResponseBody: 25_000_000,
    maximumRedirects: 3,
    dangerouslyAllowLocalIP: allowFixtureHost,
  },
  experimental: {
    // Enables `forbidden()` for role-gated pages (renders app/forbidden.tsx with a 403).
    authInterrupts: true,
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // Versioned MapLibre worker copied at install time — safe to cache forever.
        source: "/vendor/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
