import {
  ALL_WIDTHS,
  PHONE_MAX_WIDTH,
  PHOTO_QUALITY,
  PHOTO_WIDTHS,
} from "@/config/images";

/*
 * Photo URLs (site review #10). Georgia MLS photos, and the links agents paste in the
 * dashboard, come from hosts that serve full-size originals (often 1–3 MB). Those go
 * through Next's image optimizer, which makes resized WebP copies and caches them. The
 * sample photos' CDN (Unsplash) resizes on its own, so it is asked for a width directly and
 * costs the optimizer nothing.
 *
 * The URLs are built here rather than with next/image so every caller (cards, the gallery,
 * the map preview, avatars, emails) shares one rule. They are exactly what Next's default
 * loader builds for a remote image (node_modules/next/dist/shared/lib/image-loader.js:
 * `/_next/image?url=<encoded>&w=<width>&q=<quality>`); photos.test.ts holds them to it.
 * The widths and quality come from src/config/images.ts, which next.config.ts also reads.
 */

/** Where Next's image optimizer answers (next.config.ts leaves `images.path` at its default). */
export const OPTIMIZER_PATH = "/_next/image";

/** Hosts that resize on their own through a `w` query parameter. */
const SELF_RESIZING = new Set(["images.unsplash.com"]);

export type PhotoRoute = "self" | "optimize" | "as-is";

/**
 * How a photo is fetched: "self" (a CDN that resizes, given a width), "optimize" (any other
 * http(s) host, through the optimizer) or "as-is" (the site's own files, SVGs, data: URLs,
 * anything that isn't an absolute http(s) URL).
 */
export function photoRoute(src: string): PhotoRoute {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return "as-is";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "as-is";
  if (url.pathname.toLowerCase().endsWith(".svg")) return "as-is";
  return SELF_RESIZING.has(url.hostname) ? "self" : "optimize";
}

/** The smallest allowed width at least `width` wide (the largest one if none is). */
export function allowedWidth(width: number): number {
  return ALL_WIDTHS.find((w) => w >= width) ?? ALL_WIDTHS[ALL_WIDTHS.length - 1];
}

/** One URL for `src` about `width` px wide (map previews, avatars, emails). */
export function photoUrl(src: string, width: number): string {
  const route = photoRoute(src);
  if (route === "as-is") return src;
  const w = allowedWidth(width);
  if (route === "self") {
    const url = new URL(src);
    url.searchParams.set("w", String(w));
    return url.toString();
  }
  return `${OPTIMIZER_PATH}?url=${encodeURIComponent(src)}&w=${w}&q=${PHOTO_QUALITY}`;
}

/**
 * The widths worth offering for a `sizes` value, the way next/image picks them: with vw
 * sizes, every width from the smallest share of the narrowest screen up; with only px
 * sizes (thumbnails), up to 3× the largest.
 */
export function widthsFor(sizes: string): number[] {
  const vw = [...sizes.matchAll(/(^|\s)(1?\d?\d)vw/g)].map((m) => Number(m[2]));
  if (vw.length) {
    const smallest = (Math.min(...vw) / 100) * PHOTO_WIDTHS[0];
    return ALL_WIDTHS.filter((w) => w >= smallest);
  }
  const px = [...sizes.matchAll(/(\d+)px/g)].map((m) => Number(m[1]));
  if (!px.length) return [...ALL_WIDTHS];
  const cap = allowedWidth(Math.max(...px) * 3);
  return ALL_WIDTHS.filter((w) => w <= cap);
}

export type PhotoSources = {
  /** Fallback `src` (also what a browser without srcset support loads). */
  src: string;
  /** Every width, for tablets and desktops. */
  srcSet?: string;
  /** Widths up to PHONE_MAX_WIDTH, for a `<source media={PHONE_MEDIA}>`. */
  phoneSrcSet?: string;
};

const srcSetOf = (src: string, widths: number[]) =>
  widths.map((w) => `${photoUrl(src, w)} ${w}w`).join(", ");

/** The `<picture>` sources for a photo shown at `sizes`. */
export function photoSources(src: string, sizes: string): PhotoSources {
  if (photoRoute(src) === "as-is") return { src };
  const widths = widthsFor(sizes);
  const phone = widths.filter((w) => w <= PHONE_MAX_WIDTH);
  const fallback = widths.filter((w) => w <= 1200).pop() ?? widths[0];
  return {
    src: photoUrl(src, fallback),
    srcSet: srcSetOf(src, widths),
    phoneSrcSet: srcSetOf(src, phone.length ? phone : widths.slice(0, 1)),
  };
}
