"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

const LocationMap = dynamic(() => import("./location-map"), {
  ssr: false,
  loading: () => <MapPlaceholder loading />,
});

/** The map's panel before it's drawn. It pulses only while the map is on its way. */
function MapPlaceholder({ loading = false }: { loading?: boolean }) {
  return <div className={cn("size-full bg-map", loading && "animate-pulse")} />;
}

/**
 * How close (px) the map's box must come to the screen before MapLibre, the style and the
 * tiles are fetched (F28 in docs/mobile-spec/features.md).
 */
export const MAP_NEAR_PX = 300;

/**
 * The listing's location map, loaded only when the buyer scrolls near it (site review #10;
 * F28, planned for WP5). Until then it's a placeholder panel and nothing map-related downloads:
 * MapLibre's code, its worker, the style and the tiles are several hundred KB. Printing
 * before scrolling there loads it too.
 */
export function LocationMapLazy(props: { lat: number; lng: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const show = () => setNear(true);
    window.addEventListener("beforeprint", show);
    if (typeof IntersectionObserver === "undefined") {
      show();
      return () => window.removeEventListener("beforeprint", show);
    }
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && show(), {
      rootMargin: `${MAP_NEAR_PX}px 0px`,
    });
    io.observe(el);
    return () => {
      io.disconnect();
      window.removeEventListener("beforeprint", show);
    };
  }, [near]);

  return (
    <div ref={ref} className="size-full" data-location-map={near ? "loaded" : "waiting"}>
      {near ? <LocationMap {...props} /> : <MapPlaceholder />}
    </div>
  );
}
