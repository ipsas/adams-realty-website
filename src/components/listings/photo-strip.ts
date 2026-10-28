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

/** Horizontal pixels for a mostly-vertical wheel event, or null to leave the event alone. */
export function wheelDelta(deltaX: number, deltaY: number, deltaMode: number, clientWidth: number) {
  if (Math.abs(deltaY) <= Math.abs(deltaX)) return null;
  return deltaY * (deltaMode === 1 ? 16 : deltaMode === 2 ? clientWidth : 1);
}
