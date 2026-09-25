import * as maplibregl from "maplibre-gl";
import type { TransformStyleFunction } from "maplibre-gl";

import { MAP_STYLE_URL } from "./map-style";

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

/**
 * Records on the map's container which base style its canvas has finished drawing:
 * `data-map-style="light"` once the light style is fully drawn (the map is idle),
 * `"dark"` for any other style, and no attribute while a style is still loading.
 *
 * Printing is always light (globals.css), but a canvas can't restyle itself in the time a
 * print takes, so print CSS hides any map canvas not marked "light": a dark page prints the
 * light map panel instead of a black block. The maps switch to the light style while
 * printing (`useMapTheme`), and their canvas prints again once that style is drawn.
 * `isCurrent` drops a mark whose style has been replaced in the meantime. `arrived` says
 * whether the style has reached the map yet (see `swapDrawnStyle`): until it has, every
 * 'idle' is the previous style's (a hover or a finished tile repaints it) and is ignored.
 */
export function markDrawnStyle(
  map: maplibregl.Map,
  container: HTMLElement,
  url: string,
  isCurrent: () => boolean = () => true,
  arrived: () => boolean = () => true,
) {
  delete container.dataset.mapStyle;
  const onIdle = () => {
    if (!isCurrent()) {
      map.off("idle", onIdle);
      return;
    }
    if (!arrived()) return;
    map.off("idle", onIdle);
    container.dataset.mapStyle = url === MAP_STYLE_URL ? "light" : "dark";
  };
  map.on("idle", onIdle);
}

/**
 * Swaps a live map to the style at `url` and marks it (markDrawnStyle) once that style, not
 * the one it replaces, is drawn. MapLibre fetches the new style in the background and keeps
 * drawing the old one, loaded and idling, until it arrives; it applies the new one in the
 * same task that calls `transformStyle` (a diff, or a rebuilt style that isn't loaded, so
 * can't go idle, until it has been drawn), so the first 'idle' after that call is the new
 * style's.
 */
export function swapDrawnStyle(
  map: maplibregl.Map,
  container: HTMLElement,
  url: string,
  isCurrent: () => boolean,
  transformStyle: TransformStyleFunction = (_previous, next) => next,
) {
  let arrived = false;
  map.setStyle(url, {
    transformStyle: (previous, next) => {
      arrived = true;
      return transformStyle(previous, next);
    },
  });
  markDrawnStyle(map, container, url, isCurrent, () => arrived);
}
