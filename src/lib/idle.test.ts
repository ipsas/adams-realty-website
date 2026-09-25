import { afterEach, describe, expect, it, vi } from "vitest";
import { whenIdle } from "./idle";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("whenIdle", () => {
  it("is a no-op on the server", () => {
    const cb = vi.fn();
    expect(() => whenIdle(cb)()).not.toThrow();
    expect(cb).not.toHaveBeenCalled();
  });

  it("uses requestIdleCallback with the timeout when available", () => {
    const ric = vi.fn((fn: () => void) => (fn(), 7));
    const cancel = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback: ric, cancelIdleCallback: cancel });
    const cb = vi.fn();
    whenIdle(cb, { timeout: 400 })();
    expect(ric).toHaveBeenCalledWith(expect.any(Function), { timeout: 400 });
    expect(cb).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  describe("without requestIdleCallback (iOS Safari)", () => {
    function stubFrames() {
      vi.useFakeTimers();
      const frames: (() => void)[] = [];
      vi.stubGlobal("window", {
        requestAnimationFrame: (fn: () => void) => frames.push(fn),
        cancelAnimationFrame: (id: number) => (frames[id - 1] = () => {}),
      });
      return () => frames.splice(0).forEach((f) => f());
    }

    it("waits for a frame, then a macrotask", () => {
      const flushFrames = stubFrames();
      const cb = vi.fn();
      whenIdle(cb);
      vi.advanceTimersByTime(50);
      expect(cb).not.toHaveBeenCalled();
      flushFrames();
      expect(cb).not.toHaveBeenCalled();
      vi.advanceTimersByTime(0);
      expect(cb).toHaveBeenCalledOnce();
    });

    it("honors the timeout when frames are paused, and runs only once", () => {
      const flushFrames = stubFrames();
      const cb = vi.fn();
      whenIdle(cb, { timeout: 400 });
      vi.advanceTimersByTime(400);
      expect(cb).toHaveBeenCalledOnce();
      flushFrames();
      vi.advanceTimersByTime(10);
      expect(cb).toHaveBeenCalledOnce();
    });

    it("can be cancelled", () => {
      const flushFrames = stubFrames();
      const cb = vi.fn();
      const cancel = whenIdle(cb, { timeout: 400 });
      cancel();
      flushFrames();
      vi.advanceTimersByTime(1_000);
      expect(cb).not.toHaveBeenCalled();
    });
  });
});
