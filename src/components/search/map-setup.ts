import * as maplibregl from "maplibre-gl";

/** Any MapLibre style works; OpenFreeMap needs no API key. */
export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL || "https://tiles.openfreemap.org/styles/positron";

let configured = false;

/** Points MapLibre at the self-hosted worker copied by scripts/copy-maplibre-worker.mjs. */
export function ensureMapLibre() {
  if (configured) return maplibregl;
  maplibregl.setWorkerUrl(`/vendor/maplibre/${maplibregl.getVersion()}/maplibre-gl-worker.mjs`);
  configured = true;
  return maplibregl;
}
