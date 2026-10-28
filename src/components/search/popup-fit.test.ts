import { describe, expect, it } from "vitest";
import {
  fitPopupDelta,
  nextPopupStep,
  popupArea,
  popupAreaClearOf,
  popupAreaFor,
  popupAreasClearOf,
  popupRect,
  scrollCap,
  type Rect,
} from "./popup-fit";

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
});

describe("popupArea", () => {
  it("insets the map by 8 px on every side", () => {
    expect(popupArea(rect(0, 100, 390, 351))).toEqual({
      left: 8,
      top: 108,
      right: 382,
      bottom: 443,
    });
  });

  it("starts below the overlay pill when there is one", () => {
    expect(popupArea(rect(0, 100, 390, 351), 148).top).toBe(156);
    // A pill above the inset changes nothing.
    expect(popupArea(rect(0, 100, 390, 351), 90).top).toBe(108);
    expect(popupArea(rect(0, 100, 390, 351), null).top).toBe(108);
  });
});

describe("popupAreaClearOf (QA L21-4)", () => {
  // A 390 px wide map at y 100–451; MapLibre's compact attribution "i", 24 px, bottom right.
  const area = popupArea(rect(0, 100, 390, 351));
  const attrib = rect(356, 417, 24, 24);

  it("raises the bottom above the attribution when the popup is over it", () => {
    // A 280 px popup centred on a pin at x 300: fitted to 102–382, over the control.
    const popup = rect(160, 200, 280, 0);
    expect(popupAreaClearOf(area, popup, attrib)).toEqual({ ...area, bottom: 409 });
  });

  it("leaves the area alone when the fitted popup is clear of it", () => {
    // A 200 px popup on the left (8–208), and one ending 8 px short of the control.
    expect(popupAreaClearOf(area, rect(-50, 200, 200, 0), attrib)).toEqual(area);
    expect(popupAreaClearOf(area, rect(148, 200, 200, 0), attrib)).toEqual(area);
    // Within the inset of it counts as over it.
    expect(popupAreaClearOf(area, rect(149, 200, 200, 0), attrib).bottom).toBe(409);
  });

  it("ignores a missing or unrendered control, and one below the area", () => {
    const popup = rect(160, 200, 280, 0);
    expect(popupAreaClearOf(area, popup, null)).toEqual(area);
    expect(popupAreaClearOf(area, popup, undefined)).toEqual(area);
    expect(popupAreaClearOf(area, popup, rect(0, 0, 0, 0))).toEqual(area);
    expect(popupAreaClearOf(area, popup, rect(356, 460, 24, 24))).toEqual(area);
  });

  it("keeps the overlay pill's top", () => {
    const withPill = popupArea(rect(0, 100, 390, 351), 148);
    expect(popupAreaClearOf(withPill, rect(160, 200, 280, 0), attrib)).toEqual({
      ...withPill,
      bottom: 409,
    });
  });
});

describe("popupAreasClearOf (QA L21-4, 360 px)", () => {
  // A 360 × 740 phone: the map at y 178–409, the area's top under the overlay pill (258).
  const area = { ...popupArea(rect(0, 178, 360, 231)), top: 258 };
  // The most compact popup (scroll step, cap 24).
  const compact = 126;
  const height = (a: Rect) => a.bottom - a.top;

  it("finds no room for the most compact popup beside the expanded attribution", () => {
    const bar = rect(52, 375, 298, 24);
    const popup = rect(60, 0, 240, 0);
    const areas = popupAreasClearOf(area, popup, bar);
    // Only above the bar (bottom 367, 109 px); there is no room for 240 px left of it.
    expect(areas).toEqual([{ ...area, bottom: 367 }]);
    expect(height(areas[0])).toBe(109);
    expect(popupAreaFor(areas, compact)).toBeUndefined();
  });

  it("moves a right-side pin's popup left of the collapsed 'i' button", () => {
    const button = rect(326, 375, 24, 24);
    const popup = rect(112, 0, 240, 0);
    const areas = popupAreasClearOf(area, popup, button);
    expect(areas).toEqual([{ ...area, bottom: 367 }, { ...area, right: 318 }]);
    const fit = popupAreaFor(areas, compact);
    expect(fit).toEqual({ ...area, right: 318 });
    const { dx } = fitPopupDelta(rect(112, 270, 240, compact), fit!);
    // panBy(+dx) moves the popup left: 112–352 → 78–318, clear of 326 − 8.
    expect(dx).toBe(34);
    expect(352 - dx).toBe(326 - 8);
  });

  it("prefers the area above the obstacle when the popup fits there", () => {
    const button = rect(326, 375, 24, 24);
    const areas = popupAreasClearOf(area, rect(112, 0, 240, 0), button);
    expect(popupAreaFor(areas, 100)).toEqual({ ...area, bottom: 367 });
  });

  it("is just the area when the popup is clear of the obstacle", () => {
    const button = rect(326, 375, 24, 24);
    expect(popupAreasClearOf(area, rect(8, 0, 240, 0), button)).toEqual([area]);
    expect(popupAreasClearOf(area, rect(112, 0, 240, 0), null)).toEqual([area]);
  });

  it("leaves the 390 px numbers as they were", () => {
    const area390 = popupArea(rect(0, 100, 390, 351));
    const attrib = rect(356, 417, 24, 24);
    const popup = rect(160, 200, 280, 0);
    const [first] = popupAreasClearOf(area390, popup, attrib);
    expect(first).toEqual(popupAreaClearOf(area390, popup, attrib));
    expect(first).toEqual({ ...area390, bottom: 409 });
  });
});

describe("fitPopupDelta", () => {
  const area = rect(8, 8, 344, 300);

  it("leaves a popup that fits alone", () => {
    expect(fitPopupDelta(rect(50, 20, 240, 200), area)).toEqual({ dx: 0, dy: 0 });
  });

  it("pans down (negative dy) when the popup sticks out above", () => {
    expect(fitPopupDelta(rect(50, -40, 240, 200), area)).toEqual({ dx: 0, dy: -48 });
  });

  it("pans up (positive dy) when the popup sticks out below", () => {
    expect(fitPopupDelta(rect(50, 200, 240, 200), area)).toEqual({ dx: 0, dy: 92 });
  });

  it("pans sideways on either edge", () => {
    expect(fitPopupDelta(rect(-20, 20, 240, 200), area).dx).toBe(-28);
    expect(fitPopupDelta(rect(150, 20, 240, 200), area).dx).toBe(38);
  });

  it("aligns a popup larger than the area to its top", () => {
    expect(fitPopupDelta(rect(50, 30, 240, 400), area).dy).toBe(22);
  });
});

describe("popupRect", () => {
  const container = rect(0, 100, 390, 351);
  const size = { width: 260, height: 290 };

  it("sits below the pin for anchor top", () => {
    expect(popupRect({ x: 195, y: 76 }, container, size, "top", 16)).toEqual(
      rect(65, 192, 260, 290),
    );
  });

  it("sits above the pin for anchor bottom", () => {
    expect(popupRect({ x: 195, y: 300 }, container, size, "bottom", 16)).toEqual(
      rect(65, 94, 260, 290),
    );
  });

  it("lands inside the area after panning by fitPopupDelta", () => {
    const area = popupArea(container);
    const small = { width: 260, height: 200 };
    for (const [pin, anchor] of [
      [{ x: 20, y: 76 }, "top"],
      [{ x: 370, y: 330 }, "bottom"],
    ] as const) {
      const { dx, dy } = fitPopupDelta(popupRect(pin, container, small, anchor, 16), area);
      // panBy([dx, dy]) moves the pin by (-dx, -dy).
      const r = popupRect({ x: pin.x - dx, y: pin.y - dy }, container, small, anchor, 16);
      expect(r.left).toBeGreaterThanOrEqual(area.left);
      expect(r.right).toBeLessThanOrEqual(area.right);
      expect(r.top).toBeGreaterThanOrEqual(area.top);
      expect(r.bottom).toBeLessThanOrEqual(area.bottom);
    }
  });
});

describe("nextPopupStep", () => {
  it("compacts the photo first, then scrolls", () => {
    expect(nextPopupStep("full")).toBe("short-photo");
    expect(nextPopupStep("short-photo")).toBe("no-photo");
    expect(nextPopupStep("no-photo")).toBe("scroll");
    expect(nextPopupStep("scroll")).toBeNull();
  });
});

describe("scrollCap", () => {
  it("shrinks the top part by the overflow", () => {
    expect(scrollCap(80, 30)).toBe(50);
  });

  it("never goes below the minimum", () => {
    expect(scrollCap(80, 100)).toBe(24);
    expect(scrollCap(80, 100, 16)).toBe(16);
  });
});
