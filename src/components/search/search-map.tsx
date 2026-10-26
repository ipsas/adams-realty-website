"use client";

import * as maplibregl from "maplibre-gl";
import type {
  FilterSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  LayerSpecification,
  Map as MapLibreMap,
  StyleSpecification,
  SymbolLayerSpecification,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef } from "react";
import { site } from "@/config/site";
import {
  ensureMapLibre,
  handleMissingImages,
  mapStyleUrl,
  markDrawnStyle,
  swapDrawnStyle,
} from "./map-setup";
import { useMapTheme } from "@/components/theme/use-theme";
import { readResolvedTheme } from "@/lib/theme";
import { formatBaths, formatNumber, formatPrice, formatPriceShort } from "@/lib/format";
import { landSummary } from "@/lib/listings/land";
import { mlsCopyrightShort } from "@/lib/mls-copyright";
import { photoUrl } from "@/lib/photos";
import type { Bounds } from "@/lib/search/params";
import type { MapPin } from "@/lib/search/service";

const FONT = ["Noto Sans Bold"];
/**
 * Pins, clusters and price pills look the same in both themes (dark mode keeps them, like
 * photos): they sit on the map canvas, never on a page surface, so they don't use theme tokens.
 */
const MAP_OVERLAY_COLORS = {
  brand: "#1a4c39",
  onBrand: "#ffffff",
  pill: "#ffffff",
  pillStroke: "#d6d1c4",
  clusterStroke: "rgba(255,255,255,0.85)",
  dotStroke: "#ffffff",
  price: {
    closed: "#a8461f",
    pending: "#9a6b10",
    comingSoon: "#5b3fd6",
    active: "#15201c",
  },
} as const;
const C = MAP_OVERLAY_COLORS;

type Props = {
  pins: MapPin[];
  /** Current bounds filter, if the search is map-driven. */
  bounds?: Bounds;
  /** Where the searched place is, shown when it has no pins (a search with no results). */
  placeBounds?: Bounds;
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

const PILLS = {
  pill: [C.pill, C.pillStroke],
  "pill-active": [C.brand, null],
} as const satisfies Record<string, readonly [string, string | null]>;
type PillId = keyof typeof PILLS;
const isPillId = (id: string): id is PillId => Object.hasOwn(PILLS, id);

/** Adds a pill image unless the current style already has it. Images live outside the style JSON. */
function addPill(map: MapLibreMap, id: PillId) {
  if (map.hasImage(id)) return;
  const [fill, stroke] = PILLS[id];
  const { image, options } = pillImage(fill, stroke);
  map.addImage(id, image, options);
}

const SOURCE_ID = "listings";

function sourceSpec(data: GeoJSON.FeatureCollection): GeoJSONSourceSpecification {
  return { type: "geojson", data, cluster: true, clusterMaxZoom: 11, clusterRadius: 46 };
}

const PIN_LAYOUT: SymbolLayerSpecification["layout"] = {
  "text-field": ["get", "label"],
  "text-font": FONT,
  "text-size": 12,
  "icon-text-fit": "both",
  "icon-text-fit-padding": [2, 6, 2, 6],
  "icon-allow-overlap": false,
  "text-allow-overlap": false,
  "symbol-sort-key": ["case", ["get", "featured"], 0, 1],
};

const highlightFilter = (id: string | null): FilterSpecification => ["==", ["get", "id"], id ?? ""];

/** Our layers, drawn above whatever base style is showing, in this order. */
const OVERLAY_LAYERS: LayerSpecification[] = [
  {
    id: "clusters",
    type: "circle",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": C.brand,
      "circle-opacity": 0.92,
      "circle-radius": ["step", ["get", "point_count"], 15, 10, 19, 50, 25],
      "circle-stroke-width": 3,
      "circle-stroke-color": C.clusterStroke,
    },
  },
  {
    id: "cluster-count",
    type: "symbol",
    source: SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-font": FONT,
      "text-size": 12,
    },
    paint: { "text-color": C.onBrand },
  },
  // Every listing gets a dot; price pills are drawn on top where they fit
  // without colliding (featured first), so dense areas stay readable.
  {
    id: "pin-dots",
    type: "circle",
    source: SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-radius": 4.5,
      "circle-color": C.brand,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": C.dotStroke,
    },
  },
  {
    id: "pins",
    type: "symbol",
    source: SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    layout: { ...PIN_LAYOUT, "icon-image": "pill" },
    paint: {
      "text-color": [
        "match",
        ["get", "status"],
        "closed",
        C.price.closed,
        ["pending", "active_under_contract"],
        C.price.pending,
        "coming_soon",
        C.price.comingSoon,
        C.price.active,
      ],
    },
  },
  // Highlight layer: redrawn on top for the hovered listing.
  {
    id: "pins-active",
    type: "symbol",
    source: SOURCE_ID,
    filter: highlightFilter(null),
    layout: {
      ...PIN_LAYOUT,
      "icon-image": "pill-active",
      "text-size": 13,
      "icon-allow-overlap": true,
      "text-allow-overlap": true,
    },
    paint: { "text-color": C.onBrand },
  },
];
const OVERLAY_IDS = new Set(OVERLAY_LAYERS.map((l) => l.id));

/**
 * Puts the pill images, the listings source and the overlay layers on the current style.
 * Runs on every `style.load` (the first style and each theme swap) and adds only what is
 * missing, so running it again is harmless.
 */
function installOverlays(
  map: MapLibreMap,
  data: GeoJSON.FeatureCollection,
  highlightedId: string | null,
) {
  for (const id of Object.keys(PILLS) as PillId[]) addPill(map, id);
  if (!map.getSource(SOURCE_ID)) map.addSource(SOURCE_ID, sourceSpec(data));
  for (const layer of OVERLAY_LAYERS) if (!map.getLayer(layer.id)) map.addLayer(layer);
  map.setFilter("pins-active", highlightFilter(highlightedId));
}

/**
 * For a theme swap: the next base style plus our source and layers carried over from the
 * current one, so the swap diffs only the base layers and the pins never leave the map.
 */
function carryOverlays(
  previous: StyleSpecification | undefined,
  next: StyleSpecification,
): StyleSpecification {
  const listings = previous?.sources[SOURCE_ID];
  const overlays = previous?.layers.filter((l) => OVERLAY_IDS.has(l.id)) ?? [];
  return {
    ...next,
    sources: { ...next.sources, ...(listings ? { [SOURCE_ID]: listings } : {}) },
    layers: [...next.layers.filter((l) => !OVERLAY_IDS.has(l.id)), ...overlays],
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

function hasSize(el: HTMLElement): boolean {
  return el.clientWidth > 0 && el.clientHeight > 0;
}

/**
 * Where the map starts: the search's own bounds when it has them, else its
 * pins, else all of Georgia (`site.coverage.bounds`). Always a fit, never a
 * fixed center and zoom, so the view suits any screen from a phone up.
 */
function initialView(
  bounds: Bounds | undefined,
  pins: MapPin[],
  placeBounds?: Bounds,
): { bounds: maplibregl.LngLatBoundsLike; options: maplibregl.FitBoundsOptions } {
  if (bounds) return { bounds: boundsLike(bounds), options: { padding: 56, maxZoom: 14 } };
  const fromPins = pinsBounds(pins);
  if (fromPins) return { bounds: fromPins, options: { padding: 56, maxZoom: 14 } };
  // Nothing to pin: the place searched, when it's known (a town whose homes all sold).
  if (placeBounds)
    return { bounds: boundsLike(placeBounds), options: { padding: 56, maxZoom: 12 } };
  const c = site.coverage.bounds;
  return {
    bounds: [
      [c.west, c.south],
      [c.east, c.north],
    ],
    options: { padding: 24 },
  };
}

function boundsLike(b: Bounds): maplibregl.LngLatBoundsLike {
  return [
    [b.west, b.south],
    [b.east, b.north],
  ];
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

/** "3 bd · 2 ba · 1,850 sqft", or for land "Land · 12.5 acres · $8,400/acre". */
function pinFacts(p: MapPin): string {
  return (
    landSummary({
      propertyType: p.propertyType,
      livingAreaSqft: p.sqft,
      bedrooms: p.beds,
      lotSizeSqft: p.lotSqft,
      price: p.rent ? null : p.price,
    }) ?? `${p.beds ?? "—"} bd · ${formatBaths(p.baths)} ba · ${formatNumber(p.sqft)} sqft`
  );
}

/** Popup contents built with DOM APIs (never innerHTML) — listing text comes from third-party feeds. */
function popupNode(p: MapPin): HTMLElement {
  const a = document.createElement("a");
  a.href = `/homes/${p.slug}`;
  a.className = "block w-60 text-ink no-underline";
  if (p.photo) {
    const img = document.createElement("img");
    // 240 px wide at 2×; MLS photos come resized (src/lib/photos.ts).
    img.src = photoUrl(p.photo, 480);
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
  facts.textContent = pinFacts(p);
  const addr = document.createElement("p");
  addr.className = "text-xs text-muted mt-0.5 truncate";
  addr.textContent = p.address;
  body.append(price, facts, addr);
  if (p.office) {
    // IDX: the listing firm, in the same size as the other listing text.
    const office = document.createElement("p");
    office.className = "text-xs text-muted mt-0.5 break-words [overflow-wrap:anywhere]";
    office.dataset.testid = "pin-office";
    office.textContent = [`Listing by ${p.office}`, p.attributionPhone, p.attributionEmail]
      .filter(Boolean)
      .join(" · ");
    body.append(office);
  }
  if (p.fromFeed) {
    // IDX: Georgia MLS's name, logo and copyright, as on the cards (MlsCredit).
    const credit = document.createElement("p");
    credit.className = "mt-1 flex items-center gap-1.5 text-xs text-muted";
    credit.dataset.mlsCredit = "";
    const logo = site.mls.logoSmall ?? site.mls.logo;
    if (logo) {
      const img = document.createElement("img");
      img.src = logo.src;
      img.alt = site.mls.name;
      img.width = logo.width;
      img.height = logo.height;
      img.className = "h-8 w-auto rounded-sm dark:bg-white dark:px-0.5";
      credit.append(img);
    }
    credit.append(mlsCopyrightShort());
    body.append(credit);
  }
  a.append(body);
  return a;
}

export default function SearchMap({
  pins,
  bounds,
  placeBounds,
  fitKey,
  highlightedId,
  onHover,
  onUserMove,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const lastFitKey = useRef<string | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  // The style URL the map was last asked to show.
  const styleUrl = useRef<string | null>(null);
  const data = useMemo(() => toGeoJSON(pins), [pins]);
  const pinsById = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  // The page's theme, or light while printing.
  const theme = useMapTheme();

  // Keep the latest callbacks/data without re-creating the map.
  const latest = useRef({
    onHover,
    onUserMove,
    pinsById,
    data,
    highlightedId,
    bounds,
    pins,
    placeBounds,
  });
  useEffect(() => {
    latest.current = {
      onHover,
      onUserMove,
      pinsById,
      data,
      highlightedId,
      bounds,
      pins,
      placeBounds,
    };
  });
  // A fit asked for while the map had no size (hidden behind the list on phones), to run
  // as soon as it has one.
  const pendingFit = useRef(false);

  // Create the map once.
  useEffect(() => {
    if (!container.current) return;
    const initial = initialView(bounds, pins, placeBounds);

    ensureMapLibre();
    // Read synchronously (not from the hook's first value), so a dark page never starts on
    // the light style and then swaps.
    styleUrl.current = mapStyleUrl(readResolvedTheme());
    const map = new maplibregl.Map({
      container: container.current,
      style: styleUrl.current,
      bounds: initial.bounds,
      fitBoundsOptions: initial.options,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    const initialUrl = styleUrl.current;
    markDrawnStyle(map, container.current, initialUrl, () => styleUrl.current === initialUrl);
    if (process.env.NODE_ENV !== "production") {
      // For e2e and debugging only: lets tests query layers and rendered pins.
      (window as unknown as { __searchMap?: MapLibreMap }).__searchMap = map;
    }
    map.touchZoomRotate.disableRotation();

    // On phones the map starts hidden behind the list (0×0), where no fit means anything:
    // it fits when it is first shown instead (see pendingFit).
    pendingFit.current = !hasSize(container.current);
    map.on("resize", () => {
      const el = container.current;
      if (!pendingFit.current || !el || !hasSize(el)) return;
      pendingFit.current = false;
      const view = initialView(
        latest.current.bounds,
        latest.current.pins,
        latest.current.placeBounds,
      );
      // Programmatic: `movestart` sees no originalEvent, so this won't trigger a bounds search.
      map.fitBounds(view.bounds, { ...view.options, duration: 0 });
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

    // Overlays go on every style: the first one and each theme swap.
    map.on("style.load", () => {
      installOverlays(map, latest.current.data, latest.current.highlightedId);
      if (!loaded.current) {
        loaded.current = true;
        lastFitKey.current = fitKey;
      }
    });
    // Between a rebuilt style and its style.load, carried pin layers can ask for the pills
    // before they are re-added; the resolver supplies them at once so the pills never blink.
    handleMissingImages(map, (id) => {
      if (!isPillId(id)) return false;
      addPill(map, id);
      return true;
    });

    // Layer-scoped handlers belong to the map, not the style, so they survive style swaps.
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
      const zoom = await (map.getSource(SOURCE_ID) as GeoJSONSource).getClusterExpansionZoom(
        f.properties?.cluster_id as number,
      );
      map.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
    });

    // Moves nest: a resize's movestart/moveend wraps the fit it triggers (pendingFit), so
    // each movestart pushes whether it was a gesture and where the view started, and its
    // moveend pops the same entry. A tap on a pin moves nothing, and must not turn a town
    // search into a map-area one (site review #5).
    const moves: { user: boolean; center: maplibregl.LngLat; zoom: number }[] = [];
    map.on("movestart", (e) => {
      // Only user gestures carry an originalEvent.
      moves.push({
        user: "originalEvent" in e && !!e.originalEvent,
        center: map.getCenter(),
        zoom: map.getZoom(),
      });
    });
    map.on("moveend", () => {
      const start = moves.pop();
      if (!start?.user) return;
      const from = map.project(start.center);
      const to = map.project(map.getCenter());
      const moved = Math.hypot(from.x - to.x, from.y - to.y) >= 4;
      if (!moved && Math.abs(map.getZoom() - start.zoom) < 0.01) return;
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
      const w = window as unknown as { __searchMap?: MapLibreMap };
      if (w.__searchMap === map) delete w.__searchMap;
    };
    // The map is created once; later prop changes are applied by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme changes swap the base style; the overlays are carried across (and re-installed on
  // style.load if MapLibre has to rebuild the style from scratch).
  useEffect(() => {
    const map = mapRef.current;
    const el = container.current;
    const url = mapStyleUrl(theme);
    if (!map || !el || styleUrl.current === url) return;
    styleUrl.current = url;
    // Marked only once the new style, not the old one it keeps drawing meanwhile, is drawn.
    swapDrawnStyle(map, el, url, () => styleUrl.current === url, carryOverlays);
  }, [theme]);

  // New results → update the source; new non-map criteria → fit to results.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    (map.getSource(SOURCE_ID) as GeoJSONSource | undefined)?.setData(data);
    // A map-area search stays where the buyer put it; leaving it ("Back to Royston",
    // Reset) fits the results again, even when the rest of the search is unchanged.
    if (bounds) lastFitKey.current = null;
    else if (lastFitKey.current !== fitKey) {
      lastFitKey.current = fitKey;
      // No results: show the place searched, if it's known (site review #5).
      const b = pinsBounds(pins) ?? (placeBounds ? boundsLike(placeBounds) : null);
      const el = container.current;
      // Hidden (phones, list view): fit when the map is next shown.
      if (b && el && !hasSize(el)) pendingFit.current = true;
      // Programmatic: `movestart` sees no originalEvent, so this won't trigger a bounds search.
      else if (b) map.fitBounds(b, { padding: 56, maxZoom: 14, duration: 600 });
    }
  }, [data, pins, bounds, placeBounds, fitKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current || !map.getLayer("pins-active")) return;
    map.setFilter("pins-active", highlightFilter(highlightedId));
  }, [highlightedId]);

  return (
    <div
      ref={container}
      className="size-full bg-map"
      aria-label="Map of search results"
      role="region"
    />
  );
}
