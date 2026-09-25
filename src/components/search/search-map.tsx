"use client";

import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, Map as MapLibreMap, SymbolLayerSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef } from "react";
import { site } from "@/config/site";
import { ensureMapLibre, MAP_STYLE_URL } from "./map-setup";
import { formatBaths, formatNumber, formatPrice, formatPriceShort } from "@/lib/format";
import type { Bounds } from "@/lib/search/params";
import type { MapPin } from "@/lib/search/service";

const FONT = ["Noto Sans Bold"];
const BRAND = "#1a4c39";

type Props = {
  pins: MapPin[];
  /** Current bounds filter, if the search is map-driven. */
  bounds?: Bounds;
  /** Changes when the non-map criteria change; triggers a re-fit to the results. */
  fitKey: string;
  highlightedId: string | null;
  onHover: (id: string | null) => void;
  /** Called after the user pans/zooms (never for programmatic moves). */
  onUserMove: (bounds: Bounds) => void;
};

/** Stretchable rounded "pill" drawn on a canvas, used behind price labels. */
function pillImage(fill: string, stroke: string | null) {
  const ratio = 2;
  const w = 24 * ratio;
  const h = 16 * ratio;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const r = h / 2 - 1;
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, r);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
  return {
    image: ctx.getImageData(0, 0, w, h),
    options: {
      pixelRatio: ratio,
      stretchX: [[r + 2, w - r - 2]] as [number, number][],
      stretchY: [[h / 2 - 1, h / 2 + 1]] as [number, number][],
      content: [r, 4, w - r, h - 4] as [number, number, number, number],
    },
  };
}

function toGeoJSON(pins: MapPin[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: pins.map((p) => ({
      type: "Feature",
      id: p.id,
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        label: formatPriceShort(p.price),
        status: p.status,
        featured: p.featured,
      },
    })),
  };
}

function pinsBounds(pins: MapPin[]): maplibregl.LngLatBoundsLike | null {
  if (!pins.length) return null;
  let [w, s, e, n] = [180, 90, -180, -90];
  for (const p of pins) {
    w = Math.min(w, p.lng);
    e = Math.max(e, p.lng);
    s = Math.min(s, p.lat);
    n = Math.max(n, p.lat);
  }
  return [
    [w, s],
    [e, n],
  ];
}

/** Popup contents built with DOM APIs (never innerHTML) — listing text comes from third-party feeds. */
function popupNode(p: MapPin): HTMLElement {
  const a = document.createElement("a");
  a.href = `/homes/${p.slug}`;
  a.className = "block w-60 text-ink no-underline";
  if (p.photo) {
    const img = document.createElement("img");
    img.src = p.photo.replace(/w=\d+/, "w=480");
    img.alt = "";
    img.className = "h-32 w-full object-cover bg-sunken";
    img.onerror = () => img.remove();
    a.append(img);
  }
  const body = document.createElement("div");
  body.className = "p-3";
  const price = document.createElement("p");
  price.className = "text-base font-semibold";
  price.textContent = formatPrice(p.price);
  const facts = document.createElement("p");
  facts.className = "text-xs text-ink-soft mt-0.5";
  facts.textContent = `${p.beds ?? "—"} bd · ${formatBaths(p.baths)} ba · ${formatNumber(p.sqft)} sqft`;
  const addr = document.createElement("p");
  addr.className = "text-xs text-muted mt-0.5 truncate";
  addr.textContent = p.address;
  body.append(price, facts, addr);
  a.append(body);
  return a;
}

export default function SearchMap({
  pins,
  bounds,
  fitKey,
  highlightedId,
  onHover,
  onUserMove,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const programmatic = useRef(false);
  const lastFitKey = useRef<string | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const data = useMemo(() => toGeoJSON(pins), [pins]);
  const pinsById = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);

  // Keep the latest callbacks/data without re-creating the map.
  const latest = useRef({ onHover, onUserMove, pinsById, data });
  useEffect(() => {
    latest.current = { onHover, onUserMove, pinsById, data };
  });

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    const initialBounds = bounds
      ? ([
          [bounds.west, bounds.south],
          [bounds.east, bounds.north],
        ] as maplibregl.LngLatBoundsLike)
      : pinsBounds(pins);

    ensureMapLibre();
    const map = new maplibregl.Map({
      container: container.current,
      style: MAP_STYLE_URL,
      center: [site.market.center.lng, site.market.center.lat],
      zoom: site.market.zoom,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      ...(initialBounds
        ? { bounds: initialBounds, fitBoundsOptions: { padding: 56, maxZoom: 14 } }
        : {}),
    });
    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      for (const [id, fill, stroke] of [
        ["pill", "#ffffff", "#d6d1c4"],
        ["pill-active", BRAND, null],
      ] as const) {
        const { image, options } = pillImage(fill, stroke);
        map.addImage(id, image, options);
      }

      map.addSource("listings", {
        type: "geojson",
        data: latest.current.data,
        cluster: true,
        clusterMaxZoom: 11,
        clusterRadius: 46,
      });

      map.addLayer({
        id: "clusters",
        type: "circle",
        source: "listings",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": BRAND,
          "circle-opacity": 0.92,
          "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 25],
          "circle-stroke-width": 3,
          "circle-stroke-color": "rgba(255,255,255,0.85)",
        },
      });
      map.addLayer({
        id: "cluster-count",
        type: "symbol",
        source: "listings",
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": FONT,
          "text-size": 12,
        },
        paint: { "text-color": "#ffffff" },
      });

      // Every listing gets a dot; price pills are drawn on top where they fit
      // without colliding (featured first), so dense areas stay readable.
      map.addLayer({
        id: "pin-dots",
        type: "circle",
        source: "listings",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 4.5,
          "circle-color": BRAND,
          "circle-stroke-width": 1.5,
          "circle-stroke-color": "#ffffff",
        },
      });

      const pinLayout: SymbolLayerSpecification["layout"] = {
        "text-field": ["get", "label"],
        "text-font": FONT,
        "text-size": 12,
        "icon-text-fit": "both",
        "icon-text-fit-padding": [2, 6, 2, 6],
        "icon-allow-overlap": false,
        "text-allow-overlap": false,
        "symbol-sort-key": ["case", ["get", "featured"], 0, 1],
      };

      map.addLayer({
        id: "pins",
        type: "symbol",
        source: "listings",
        filter: ["!", ["has", "point_count"]],
        layout: { ...pinLayout, "icon-image": "pill" },
        paint: {
          "text-color": [
            "match",
            ["get", "status"],
            "closed",
            "#a8461f",
            ["pending", "active_under_contract"],
            "#9a6b10",
            "coming_soon",
            "#5b3fd6",
            "#15201c",
          ],
        },
      });
      // Highlight layer: redrawn on top for the hovered listing.
      map.addLayer({
        id: "pins-active",
        type: "symbol",
        source: "listings",
        filter: ["==", ["get", "id"], ""],
        layout: {
          ...pinLayout,
          "icon-image": "pill-active",
          "text-size": 13,
          "icon-allow-overlap": true,
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#ffffff" },
      });

      for (const layer of ["pin-dots", "pins", "pins-active"]) {
        map.on("mouseenter", layer, (e) => {
          map.getCanvas().style.cursor = "pointer";
          const id = e.features?.[0]?.properties?.id as string | undefined;
          if (id) latest.current.onHover(id);
        });
        map.on("mouseleave", layer, () => {
          map.getCanvas().style.cursor = "";
          latest.current.onHover(null);
        });
        map.on("click", layer, (e) => {
          const f = e.features?.[0];
          const pin = f ? latest.current.pinsById.get(f.properties?.id as string) : undefined;
          if (!pin) return;
          popup.current?.remove();
          popup.current = new maplibregl.Popup({
            offset: 16,
            closeButton: false,
            maxWidth: "260px",
          })
            .setLngLat([pin.lng, pin.lat])
            .setDOMContent(popupNode(pin))
            .addTo(map);
        });
      }
      map.on("mouseenter", "clusters", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "clusters", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "clusters", async (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const zoom = await (map.getSource("listings") as GeoJSONSource).getClusterExpansionZoom(
          f.properties?.cluster_id as number,
        );
        map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      });

      loaded.current = true;
      lastFitKey.current = fitKey;
    });

    map.on("movestart", (e) => {
      // Only user gestures carry an originalEvent.
      programmatic.current = !("originalEvent" in e && e.originalEvent);
    });
    map.on("moveend", () => {
      if (programmatic.current) {
        programmatic.current = false;
        return;
      }
      const b = map.getBounds();
      latest.current.onUserMove({
        west: b.getWest(),
        south: b.getSouth(),
        east: b.getEast(),
        north: b.getNorth(),
      });
    });

    return () => {
      popup.current?.remove();
      map.remove();
      mapRef.current = null;
      loaded.current = false;
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // New results → update the source; new non-map criteria → fit to results.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    (map.getSource("listings") as GeoJSONSource | undefined)?.setData(data);
    if (!bounds && lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      const b = pinsBounds(pins);
      // Programmatic: `movestart` sees no originalEvent, so this won't trigger a bounds search.
      if (b) map.fitBounds(b, { padding: 56, maxZoom: 14, duration: 600 });
    }
  }, [data, pins, bounds, fitKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current || !map.getLayer("pins-active")) return;
    map.setFilter("pins-active", ["==", ["get", "id"], highlightedId ?? ""]);
  }, [highlightedId]);

  return (
    <div
      ref={container}
      className="size-full bg-[#eef0ec]"
      aria-label="Map of search results"
      role="region"
    />
  );
}
