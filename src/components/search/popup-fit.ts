/**
 * Fitting the map's pin popup inside a small map (QA L18-1). Below lg the map can be ~250 px
 * tall while a popup is ~290 px, so the listing firm and the Georgia MLS credit (IDX) could sit
 * below the map's edge. Pure geometry here; the DOM wiring is in search-map.tsx.
 */

export type Rect = { top: number; right: number; bottom: number; left: number };

/** Space kept between the popup and the map's edges (and the overlay pill). */
export const POPUP_INSET = 8;

/**
 * Where the popup may sit: the map's rect inset on every side, with the top below the
 * overlay pill ("Search as I move the map") when there is one.
 */
export function popupArea(map: Rect, overlayBottom?: number | null, inset = POPUP_INSET): Rect {
  const top = map.top + inset;
  return {
    top: overlayBottom == null ? top : Math.max(top, overlayBottom + inset),
    right: map.right - inset,
    bottom: map.bottom - inset,
    left: map.left + inset,
  };
}

/**
 * The area with its bottom raised above `obstacle` (the map's attribution control, bottom
 * right; QA L21-4) when the popup, once fitted sideways, would be over it, so the control
 * stays visible. Unchanged with no obstacle, an empty one (not rendered), or one clear of
 * the popup's columns. `popup` is its rect from the pin (`popupRect`); only its width and
 * horizontal position are used.
 */
export function popupAreaClearOf(
  area: Rect,
  popup: Rect,
  obstacle?: Rect | null,
  inset = POPUP_INSET,
): Rect {
  if (!obstacle || obstacle.right <= obstacle.left || obstacle.bottom <= obstacle.top) {
    return area;
  }
  const dx = axisDelta(popup.left, popup.right, area.left, area.right);
  const left = popup.left - dx;
  const right = popup.right - dx;
  if (right + inset <= obstacle.left || left - inset >= obstacle.right) return area;
  return { ...area, bottom: Math.min(area.bottom, obstacle.top - inset) };
}

/** The offset along one axis that brings [start, end] inside [areaStart, areaEnd] (start first). */
function axisDelta(start: number, end: number, areaStart: number, areaEnd: number): number {
  if (start < areaStart || end - start > areaEnd - areaStart) return start - areaStart;
  if (end > areaEnd) return end - areaEnd;
  return 0;
}

/**
 * The popup's rect from its pin (`map.project`, container px) rather than the DOM, which can
 * lag a frame behind addTo/panBy: centred on the pin, below it for anchor "top", above it for
 * "bottom", `offset` px away. `size` is the popup's layout size (offsetWidth/offsetHeight).
 */
export function popupRect(
  pin: { x: number; y: number },
  container: Rect,
  size: { width: number; height: number },
  anchor: "top" | "bottom",
  offset: number,
): Rect {
  const left = container.left + pin.x - size.width / 2;
  const top =
    anchor === "top"
      ? container.top + pin.y + offset
      : container.top + pin.y - offset - size.height;
  return { top, right: left + size.width, bottom: top + size.height, left };
}

/**
 * The `map.panBy` offset that moves the popup inside the area (panning by +dx moves the
 * content left). A popup larger than the area is aligned to its top/left edge.
 */
export function fitPopupDelta(popup: Rect, area: Rect): { dx: number; dy: number } {
  return {
    dx: axisDelta(popup.left, popup.right, area.left, area.right),
    dy: axisDelta(popup.top, popup.bottom, area.top, area.bottom),
  };
}

/**
 * How compact the popup is, tried in this order until it fits: the full popup, a shorter
 * photo, no photo, then the price/facts/address part capped and scrolling. The firm line and
 * the MLS credit are never compacted.
 */
export const POPUP_STEPS = ["full", "short-photo", "no-photo", "scroll"] as const;
export type PopupStep = (typeof POPUP_STEPS)[number];

/** The next step to try when the popup is still too tall, or null when none is left. */
export function nextPopupStep(step: PopupStep): PopupStep | null {
  return POPUP_STEPS[POPUP_STEPS.indexOf(step) + 1] ?? null;
}

/**
 * The max height for the scrolling top part: its height less what the popup overflows by,
 * but never below `min` (so at least a line of it stays readable).
 */
export function scrollCap(headHeight: number, overflow: number, min = 24): number {
  return Math.max(min, Math.floor(headHeight - overflow));
}
