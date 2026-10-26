/**
 * Listing photo sizes (site review #10). Shared by next.config.ts (the image optimizer's
 * `deviceSizes`, `imageSizes` and `qualities`) and src/lib/photos.ts (the URLs <Photo> asks
 * for), so the two can't drift: the optimizer refuses any width or quality not listed here.
 *
 * Few sizes on purpose. Each (photo, width) pair is one paid transformation on Vercel, so a
 * short list keeps both the bill and what an abuser can make the optimizer do small.
 *
 * No imports: next.config.ts loads this file directly.
 */

/** Widths for photos that span a good part of the screen (cards, the gallery, the viewer). */
export const PHOTO_WIDTHS = [480, 640, 800, 1080, 1200, 1600, 1920] as const;

/**
 * Extra widths for the home page hero: it covers a box taller than wide on phones, so
 * high-DPI screens need more than 1920 px. next.config.ts adds them to `deviceSizes`;
 * src/lib/photos.ts never asks for them, so listing photos stay within PHOTO_WIDTHS.
 */
export const HERO_EXTRA_WIDTHS = [2560, 3840] as const;

/** Widths for small images (thumbnails, avatars, map previews). All below PHOTO_WIDTHS[0]. */
export const THUMB_WIDTHS = [96, 160, 256, 384] as const;

/** Every width the optimizer will make, smallest first. */
export const ALL_WIDTHS: readonly number[] = [...THUMB_WIDTHS, ...PHOTO_WIDTHS];

/** JPEG/WebP quality for resized photos. The only one the optimizer allows. */
export const PHOTO_QUALITY = 70;

/**
 * Phones never get a photo wider than this (the review measured 161 KB → 71 KB on one photo
 * going from 1,200 to 800 px). A 412 px-wide phone at 2.6× would otherwise pick 1,080.
 */
export const PHONE_MAX_WIDTH = 800;

/**
 * Which screens count as phones for PHONE_MAX_WIDTH: narrow ones, and touch screens that are
 * short (a phone held sideways is 844 px wide but only 390 px tall).
 */
export const PHONE_MEDIA = "(max-width: 767px), (pointer: coarse) and (max-height: 500px)";

/**
 * How long an optimized copy is kept before the optimizer fetches the original again, in
 * seconds. A week: MLS photo URLs normally change when the photo does, and a photo replaced
 * at the same URL shows its old copy for at most this long.
 */
export const PHOTO_CACHE_SECONDS = 7 * 24 * 60 * 60;

/**
 * The fake MLS photo host the tests and scripts/perf/photo-weight.ts start
 * (e2e/fixtures/photo-host.mjs). next.config.ts lets the optimizer fetch from it outside
 * production only, because it's on 127.0.0.1.
 */
export const FIXTURE_PHOTO_HOST = "http://127.0.0.1:4010";
