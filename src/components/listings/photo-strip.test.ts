import { describe, expect, it } from "vitest";
import {
  arrowStep,
  centerTarget,
  pageTarget,
  pagerDisabled,
  pagerFallback,
  pagerKey,
  stripEdges,
  wheelDelta,
} from "./photo-strip";

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

describe("pagerDisabled", () => {
  it("disables each pager at its own end", () => {
    expect(pagerDisabled(-1, { atStart: true, atEnd: false })).toBe(true);
    expect(pagerDisabled(1, { atStart: true, atEnd: false })).toBe(false);
    expect(pagerDisabled(-1, { atStart: false, atEnd: true })).toBe(false);
    expect(pagerDisabled(1, { atStart: false, atEnd: true })).toBe(true);
  });
});

describe("pagerFallback", () => {
  it("moves focus to the opposite pager", () => {
    expect(pagerFallback(1, { atStart: false, atEnd: true })).toBe(-1);
    expect(pagerFallback(-1, { atStart: true, atEnd: false })).toBe(1);
  });
  it("falls back to the current thumb when both pagers are disabled", () => {
    expect(pagerFallback(1, { atStart: true, atEnd: true })).toBe("thumb");
    expect(pagerFallback(-1, { atStart: true, atEnd: true })).toBe("thumb");
  });
});

describe("arrowStep", () => {
  const MODS = ["altKey", "ctrlKey", "metaKey", "shiftKey"] as const;
  const key = (k: string, mod?: (typeof MODS)[number]) => ({
    key: k,
    altKey: mod === "altKey",
    ctrlKey: mod === "ctrlKey",
    metaKey: mod === "metaKey",
    shiftKey: mod === "shiftKey",
  });
  it("steps on bare left and right arrows", () => {
    expect(arrowStep(key("ArrowRight"))).toBe(1);
    expect(arrowStep(key("ArrowLeft"))).toBe(-1);
  });
  it("ignores other keys", () => {
    expect(arrowStep(key("ArrowUp"))).toBeNull();
    expect(arrowStep(key("Enter"))).toBeNull();
  });
  it("ignores arrows with any modifier", () => {
    for (const mod of MODS) {
      expect(arrowStep(key("ArrowRight", mod))).toBeNull();
      expect(arrowStep(key("ArrowLeft", mod))).toBeNull();
    }
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

describe("pagerKey", () => {
  const down = (key: string, repeat = false) => ({ type: "keydown" as const, key, repeat });
  const up = (key: string) => ({ type: "keyup" as const, key, repeat: false });

  /**
   * Two pagers, each with its own `held` (reset on focus). Starts on the right pager, which
   * disables after `pagesToEnd` pages; focus then moves to the left one (the L27-1 fallback).
   */
  function strip(key: string, pagesToEnd: number) {
    const held = { left: null as string | null, right: null as string | null };
    const s = { focused: "right" as "left" | "right", pos: 0 };
    const press = (e: Parameters<typeof pagerKey>[1]) => {
      const r = pagerKey(held[s.focused], e);
      held[s.focused] = r.held;
      // Enter clicks on every keydown, Space on keyup, unless prevented.
      const clicks = key === "Enter" ? e.type === "keydown" : e.type === "keyup";
      if (!r.block && clicks) s.pos += s.focused === "right" ? 1 : -1;
      if (s.focused === "right" && s.pos === pagesToEnd) {
        s.focused = "left";
        held.left = null;
      }
    };
    return { s, press };
  }

  it("pages to the end on a held Enter, then ignores the hold on the newly focused pager", () => {
    const { s, press } = strip("Enter", 3);
    press(down("Enter"));
    for (let i = 0; i < 10; i++) press(down("Enter", true));
    press(up("Enter"));
    expect(s).toEqual({ focused: "left", pos: 3 });
    press(down("Enter"));
    expect(s.pos).toBe(2);
  });

  it("doesn't let a held Space's repeats or keyup activate the newly focused pager", () => {
    const { s, press } = strip(" ", 1);
    press(down(" "));
    for (let i = 0; i < 5; i++) press(down(" ", true));
    // Focus moves mid-hold (e.g. the strip reached its end on a previous page).
    s.focused = "left";
    press(down(" ", true));
    press(up(" "));
    expect(s.pos).toBe(0);
    press(down(" "));
    press(up(" "));
    expect(s.pos).toBe(-1);
  });

  it("blocks repeats and keyups of a hold that began elsewhere", () => {
    expect(pagerKey(null, down("Enter", true))).toEqual({ block: true, held: null });
    expect(pagerKey(null, down(" ", true))).toEqual({ block: true, held: null });
    expect(pagerKey(null, up(" "))).toEqual({ block: true, held: null });
    expect(pagerKey(" ", down("Enter", true)).block).toBe(true);
  });

  it("lets a fresh press and its own repeats and keyup through", () => {
    expect(pagerKey(null, down("Enter"))).toEqual({ block: false, held: "Enter" });
    expect(pagerKey("Enter", down("Enter", true))).toEqual({ block: false, held: "Enter" });
    expect(pagerKey(null, down(" "))).toEqual({ block: false, held: " " });
    expect(pagerKey(" ", up(" "))).toEqual({ block: false, held: null });
  });

  it("leaves other keys alone", () => {
    for (const key of ["Tab", "ArrowLeft", "Shift", "a"]) {
      expect(pagerKey(null, down(key, true))).toEqual({ block: false, held: null });
      expect(pagerKey("Enter", up(key))).toEqual({ block: false, held: "Enter" });
    }
  });
});
