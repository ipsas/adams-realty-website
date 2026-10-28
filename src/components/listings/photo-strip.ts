// Scroll geometry for the lightbox thumbnail strip, kept free of the DOM so it can be unit-tested.

/** One thumbnail plus the gap after it (w-20 + gap-2). */
export const THUMB_PITCH = 88;

const clamp = (left: number, clientWidth: number, scrollWidth: number) =>
  Math.min(Math.max(left, 0), Math.max(scrollWidth - clientWidth, 0));

/** Whether the strip is scrolled to either end (1px tolerance for fractional scroll positions). */
export function stripEdges(scrollLeft: number, clientWidth: number, scrollWidth: number) {
  return { atStart: scrollLeft <= 1, atEnd: scrollLeft + clientWidth >= scrollWidth - 1 };
}

/** One screenful in `dir`, less one thumb so the last one seen stays in view for context. */
export function pageTarget(
  scrollLeft: number,
  clientWidth: number,
  scrollWidth: number,
  dir: 1 | -1,
  pitch = THUMB_PITCH,
) {
  const step = Math.max(clientWidth - pitch, pitch);
  return clamp(scrollLeft + dir * step, clientWidth, scrollWidth);
}

/** The scrollLeft that centres a thumb at `thumbOffsetLeft` (in scroll-content coordinates). */
export function centerTarget(
  thumbOffsetLeft: number,
  thumbWidth: number,
  clientWidth: number,
  scrollWidth: number,
) {
  return clamp(thumbOffsetLeft + thumbWidth / 2 - clientWidth / 2, clientWidth, scrollWidth);
}

/** Whether the pager scrolling in `dir` has nowhere left to go. */
export const pagerDisabled = (dir: 1 | -1, edges: ReturnType<typeof stripEdges>) =>
  dir < 0 ? edges.atStart : edges.atEnd;

/**
 * Where focus goes when the focused pager for `dir` becomes disabled, so it doesn't drop to
 * <body>: the opposite pager, or the current thumb if that one is disabled too.
 */
export function pagerFallback(dir: 1 | -1, edges: ReturnType<typeof stripEdges>) {
  const other = dir < 0 ? 1 : -1;
  return pagerDisabled(other, edges) ? "thumb" : other;
}

/** The photo step for a lightbox keydown: bare ←/→ only, so modified arrows keep their meaning. */
export function arrowStep(
  e: Pick<KeyboardEvent, "key" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey">,
): 1 | -1 | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  return e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : null;
}

/** Horizontal pixels for a mostly-vertical wheel event, or null to leave the event alone. */
export function wheelDelta(deltaX: number, deltaY: number, deltaMode: number, clientWidth: number) {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  return deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? clientWidth : 1);
}
