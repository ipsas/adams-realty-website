"use client";

import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef } from "react";
import { ensureMapLibre, handleMissingImages, mapStyleUrl } from "@/components/search/map-setup";
import { useClientTheme } from "@/components/theme/use-theme";

/**
 * Small, lightly interactive map with a single home marker. It follows the theme by
 * recreating the map (cheap: one marker, no overlays). `useClientTheme` reads the theme
 * synchronously before hydration, so the first map already has the right style.
 */
export default function LocationMap({
  lat,
  lng,
  label,
}: {
  lat: number;
  lng: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const style = mapStyleUrl(useClientTheme());
  useEffect(() => {
    if (!ref.current) return;
    ensureMapLibre();
    const map = new maplibregl.Map({
      container: ref.current,
      style,
      center: [lng, lat],
      zoom: 14,
      attributionControl: { compact: true },
      cooperativeGestures: true,
      dragRotate: false,
    });
    handleMissingImages(map);
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const el = document.createElement("div");
    el.className =
      "flex size-11 items-center justify-center rounded-full bg-primary text-white shadow-lift ring-4 ring-white";
    el.setAttribute("aria-label", label);
    el.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>';
    new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    return () => map.remove();
  }, [lat, lng, label, style]);
  return <div ref={ref} className="size-full bg-map" />;
}
