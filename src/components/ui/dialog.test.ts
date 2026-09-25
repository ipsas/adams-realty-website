import { describe, expect, it } from "vitest";
import { dialogKeysOf, keyboardInset, nearestScrollTop, shouldDismissSwipe } from "./dialog";

describe("keyboardInset", () => {
  it("is the part of the layout viewport covered below the visual viewport", () => {
    expect(keyboardInset(844, 844, 0)).toBe(0);
    expect(keyboardInset(844, 464, 0)).toBe(380);
    // iOS pans the visual viewport up while typing.
    expect(keyboardInset(844, 464, 100)).toBe(280);
  });

  it("never goes negative and ignores bad input", () => {
    expect(keyboardInset(800, 820, 0)).toBe(0);
    expect(keyboardInset(800, Number.NaN, 0)).toBe(0);
  });
});

describe("shouldDismissSwipe", () => {
  it("dismisses past 96px", () => {
    expect(shouldDismissSwipe(97, 0)).toBe(true);
    expect(shouldDismissSwipe(96, 0)).toBe(false);
  });

  it("dismisses a fast flick, but not a tiny twitch", () => {
    expect(shouldDismissSwipe(40, 0.8)).toBe(true);
    expect(shouldDismissSwipe(40, 0.4)).toBe(false);
    expect(shouldDismissSwipe(8, 2)).toBe(false);
  });

  it("never dismisses an upward drag", () => {
    expect(shouldDismissSwipe(-200, 3)).toBe(false);
  });
});

describe("nearestScrollTop", () => {
  it("leaves visible targets alone", () => {
    expect(nearestScrollTop(100, 400, 200, 250)).toBe(100);
  });

  it("scrolls down just enough to show a target below", () => {
    expect(nearestScrollTop(0, 400, 500, 544)).toBe(544 + 12 - 400);
  });

  it("scrolls up to show a target above", () => {
    expect(nearestScrollTop(300, 400, 100, 144)).toBe(88);
    expect(nearestScrollTop(300, 400, 4, 40)).toBe(0);
  });

  it("aligns the top of targets taller than the viewport", () => {
    expect(nearestScrollTop(0, 200, 300, 700)).toBe(288);
  });
});

describe("dialogKeysOf", () => {
  it("reads the dialog key stack from a history state", () => {
    expect(dialogKeysOf({ __NA: true, __dialogs: ["a", "b"] })).toEqual(["a", "b"]);
    expect(dialogKeysOf({ __NA: true })).toEqual([]);
    expect(dialogKeysOf(null)).toEqual([]);
    expect(dialogKeysOf({ __dialogs: ["a", 3] })).toEqual(["a"]);
  });
});
