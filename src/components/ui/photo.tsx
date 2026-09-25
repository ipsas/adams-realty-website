"use client";

/* eslint-disable @next/next/no-img-element --
 * Listing photos come from MLS/vendor CDNs that already serve sized images.
 * Routing tens of thousands of them through the Next image optimizer adds
 * cost without much benefit, so we render plain <img> with srcset/lazy
 * loading and a graceful fallback instead. */

import { House } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const WIDTHS = [480, 800, 1200, 1600, 2000];

/** Resizes images on CDNs that support a width parameter; returns others untouched. */
export function sizedUrl(src: string, width: number): string {
  try {
    const url = new URL(src);
    if (url.hostname === "images.unsplash.com") {
      url.searchParams.set("w", String(width));
      return url.toString();
    }
  } catch {
    // Not an absolute URL — fall through.
  }
  return src;
}

function supportsResize(src: string) {
  return src.startsWith("https://images.unsplash.com/");
}

export function Photo({
  src,
  alt,
  sizes = "100vw",
  className,
  priority = false,
  fallbackClassName,
}: {
  src: string | null | undefined;
  alt: string;
  sizes?: string;
  className?: string;
  priority?: boolean;
  fallbackClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);

  // If the image errored before hydration, onError never fired — check now.
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (!src || failed) return <PhotoFallback className={cn(className, fallbackClassName)} />;

  const resizable = supportsResize(src);
  return (
    <img
      ref={ref}
      src={resizable ? sizedUrl(src, 1200) : src}
      srcSet={resizable ? WIDTHS.map((w) => `${sizedUrl(src, w)} ${w}w`).join(", ") : undefined}
      sizes={resizable ? sizes : undefined}
      alt={alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
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
