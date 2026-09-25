import * as maplibregl from "maplibre-gl";

export { MAP_STYLE_DARK_URL, MAP_STYLE_URL, mapStyleUrl, type MapTheme } from "./map-style";

let configured = false;

/** Points MapLibre at the self-hosted worker copied by scripts/copy-maplibre-worker.mjs. */
export function ensureMapLibre() {
  if (configured) return maplibregl;
  maplibregl.setWorkerUrl(`/vendor/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
  configured = true;
  return maplibregl;
}

/**
 * Resolves images a style asks for but doesn't have (MapLibre's missing-image resolver,
 * which it keeps across style swaps and awaits before drawing). `resolve` supplies our own
 * images and returns true when it did. Anything else is an icon the base style names but its
 * sprite lacks (OpenFreeMap's dark style asks for "circle-11"): it gets a transparent pixel,
 * which draws exactly what the missing icon drew, without a console warning.
 */
export function handleMissingImages(
  map: maplibregl.Map,
  resolve: (id: string) => boolean = () => false,
) {
  map.setMissingStyleImageResolver((id) => {
    if (map.hasImage(id) || resolve(id)) return;
    map.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
  });
}
