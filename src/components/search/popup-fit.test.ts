import { describe, expect, it } from "vitest";
import {
  fitPopupDelta,
  nextPopupStep,
  popupArea,
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
