"use client";

/* eslint-disable @next/next/no-img-element -- see photo.tsx */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { initials } from "@/lib/format";
import { sizedUrl } from "./photo";

export function Avatar({
  src,
  name,
  className,
}: {
  src: string | null | undefined;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);

  if (!src || failed) {
    return (
      <span
        aria-label={name}
        role="img"
        className={cn(
          "flex items-center justify-center bg-gradient-to-br from-brand-600 to-brand-800 font-display font-medium text-white",
          className,
        )}
      >
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      ref={ref}
      src={sizedUrl(src, 400)}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn("object-cover", className)}
    />
  );
}
