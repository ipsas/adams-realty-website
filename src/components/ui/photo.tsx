"use client";

/*
 * A plain <picture>/<img> built from src/lib/photos.ts rather than next/image: MLS photos go
 * through Next's image optimizer (the same /_next/image URLs next/image would use), the
 * sample photos' CDN resizes on its own, and phones get their own srcset capped at
 * PHONE_MAX_WIDTH, which next/image can't express (site review #10). */

import { House } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import { PHONE_MEDIA } from "@/config/images";
import { cn } from "@/lib/cn";
import { photoSources } from "@/lib/photos";

/**
 * How soon a photo loads. `true`: now, ahead of other images. "eager": now, at normal priority
 * (above the fold, but not the page's largest image). "preload": like `true`, and also named
 * in the document head so the browser starts it before it reaches the <img> (the page's LCP).
 */
export type PhotoPriority = boolean | "eager" | "preload";

export function Photo({
  src,
  alt,
  sizes = "100vw",
  className,
  priority = false,
  fallbackClassName,
  nearPx,
}: {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  className?: string;
  /** Above the fold (see PhotoPriority). Everything else loads near the viewport. */
  priority?: PhotoPriority;
  fallbackClassName?: string;
  /**
   * Hold the photo back until its box is within this many px of the screen (an empty frame
   * until then, and nothing in the server HTML). For photos far down a page, such as
   * similar homes: the browser's own lazy loading starts 1,250–2,500 px ahead.
   */
  nearPx?: number;
}) {
  const [failed, setFailed] = useState(false);
  const [near, setNear] = useState(nearPx === undefined);
  // Once shown, a photo stays; a card that moves up the list (no nearPx now) shows at once.
  const shown = near || nearPx === undefined;
  const ref = useRef<HTMLImageElement>(null);
  const frame = useRef<HTMLDivElement>(null);

  // If the image errored before hydration, onError never fired — check now.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  useEffect(() => {
    const el = frame.current;
    if (shown || !el) return;
    if (typeof IntersectionObserver === "undefined") {
      const t = setTimeout(() => setNear(true));
      return () => clearTimeout(t);
    }
    const margin = `${nearPx}px 0px`;
    // scrollMargin (Chromium) grows scroll panes' clip too, like the desktop results list;
    // elsewhere a photo in a pane waits until the pane shows it.
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setNear(true), {
      rootMargin: margin,
      scrollMargin: margin,
    } as IntersectionObserverInit);
    io.observe(el);
    return () => io.disconnect();
  }, [shown, nearPx]);

  if (!src || failed) return <PhotoFallback className={cn(className, fallbackClassName)} />;
  if (!shown) return <div ref={frame} aria-hidden className={cn("bg-sunken", className)} />;

  const sources = photoSources(src, sizes);
  const high = priority === true || priority === "preload";
  if (priority === "preload") {
    // Phones take the <source>'s set, so only they preload it; elsewhere the <img> starts it.
    if (sources.phoneSrcSet) {
      preload(sources.src, {
        as: "image",
        imageSrcSet: sources.phoneSrcSet,
        imageSizes: sizes,
        media: PHONE_MEDIA,
        fetchPriority: "high",
      });
    } else {
      preload(sources.src, {
        as: "image",
        imageSrcSet: sources.srcSet,
        imageSizes: sources.srcSet ? sizes : undefined,
        fetchPriority: "high",
      });
    }
  }
  return (
    // `contents`: the <picture> adds no box, so the <img> sizes and positions as before.
    <picture className="contents">
      {sources.phoneSrcSet && (
        <source media={PHONE_MEDIA} srcSet={sources.phoneSrcSet} sizes={sizes} />
      )}
      <img
        ref={ref}
        src={sources.src}
        srcSet={sources.srcSet}
        sizes={sources.srcSet ? sizes : undefined}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={high ? "high" : undefined}
        decoding="async"
        onError={() => setFailed(true)}
        className={cn("object-cover", className)}
      />
    </picture>
  );
}

export function PhotoFallback({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex items-center justify-center bg-gradient-to-br from-brand-50 via-sunken to-brass-100 text-brand-300",
        className,
      )}
    >
      <House className="size-10" strokeWidth={1.25} />
    </div>
  );
}
