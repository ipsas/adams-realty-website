import { describe, expect, it } from "vitest";
import { centerTarget, pageTarget, stripEdges, wheelDelta } from "./photo-strip";

describe("stripEdges", () => {
  it("is at both ends when the strip doesn't overflow", () => {
    expect(stripEdges(0, 800, 800)).toEqual({ atStart: true, atEnd: true });
    expect(stripEdges(0, 800, 400)).toEqual({ atStart: true, atEnd: true });
  });
  it("tracks the start, middle and end with 1px tolerance", () => {
    expect(stripEdges(0.5, 800, 2000)).toEqual({ atStart: true, atEnd: false });
    expect(stripEdges(600, 800, 2000)).toEqual({ atStart: false, atEnd: false });
    expect(stripEdges(1199.5, 800, 2000)).toEqual({ atStart: false, atEnd: true });
  });
});

describe("pageTarget", () => {
  it("pages by the client width less one thumb", () => {
    expect(pageTarget(0, 800, 5000, 1)).toBe(712);
    expect(pageTarget(1000, 800, 5000, -1)).toBe(288);
  });
  it("clamps to the scroll range", () => {
    expect(pageTarget(100, 800, 5000, -1)).toBe(0);
    expect(pageTarget(4000, 800, 5000, 1)).toBe(4200);
    expect(pageTarget(0, 800, 600, 1)).toBe(0);
  });
  it("still moves by at least one thumb on a narrow strip", () => {
    expect(pageTarget(0, 60, 5000, 1)).toBe(88);
  });
});

describe("centerTarget", () => {
  it("centres the thumb", () => {
    expect(centerTarget(1000, 80, 800, 5000)).toBe(640);
  });
  it("clamps near either end", () => {
    expect(centerTarget(4, 80, 800, 5000)).toBe(0);
    expect(centerTarget(4900, 80, 800, 5000)).toBe(4200);
    expect(centerTarget(300, 80, 800, 500)).toBe(0);
  });
});

describe("wheelDelta", () => {
  it("leaves horizontal and empty wheels alone", () => {
    expect(wheelDelta(30, 10, 0, 800)).toBeNull();
    expect(wheelDelta(20, -20, 0, 800)).toBeNull();
    expect(wheelDelta(0, 0, 0, 800)).toBeNull();
  });
  it("converts vertical deltas by mode", () => {
    expect(wheelDelta(0, 100, 0, 800)).toBe(100);
    expect(wheelDelta(2, -3, 1, 800)).toBe(-48);
    expect(wheelDelta(0, 1, 2, 800)).toBe(800);
  });
});
