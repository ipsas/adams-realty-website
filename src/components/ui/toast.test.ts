import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createToastStore, DEFAULT_TOAST_DURATION } from "./toast";

describe("toast store", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows one toast at a time; a new one replaces the current", () => {
    const store = createToastStore();
    const a = store.show("First");
    const b = store.show("Second", { tone: "error" });
    expect(b).not.toBe(a);
    expect(store.getSnapshot().toast).toMatchObject({ id: b, message: "Second", tone: "error" });
  });

  it("auto-dismisses after the default duration", () => {
    const store = createToastStore();
    store.show("Saved");
    vi.advanceTimersByTime(DEFAULT_TOAST_DURATION - 1);
    expect(store.getSnapshot().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().toast).toBeNull();
  });

  it("a replaced toast's timer never dismisses its successor", () => {
    const store = createToastStore();
    store.show("First", { duration: 1000 });
    vi.advanceTimersByTime(900);
    store.show("Second", { duration: 1000 });
    vi.advanceTimersByTime(500);
    expect(store.getSnapshot().toast?.message).toBe("Second");
    vi.advanceTimersByTime(500);
    expect(store.getSnapshot().toast).toBeNull();
  });

  it("keeps Infinity-duration toasts until dismissed", () => {
    const store = createToastStore();
    store.show("Offline", { duration: Infinity });
    vi.advanceTimersByTime(60_000);
    expect(store.getSnapshot().toast?.message).toBe("Offline");
    store.dismiss();
    expect(store.getSnapshot().toast).toBeNull();
  });

  it("dismiss(id) only dismisses that toast if it is still showing", () => {
    const store = createToastStore();
    const old = store.show("Old");
    store.show("New");
    store.dismiss(old);
    expect(store.getSnapshot().toast?.message).toBe("New");
  });

  it("pauses and resumes the remaining time", () => {
    const store = createToastStore();
    store.show("Undo?", { duration: 5000 });
    vi.advanceTimersByTime(3000);
    store.pause();
    vi.advanceTimersByTime(10_000);
    expect(store.getSnapshot().toast).not.toBeNull();
    store.resume();
    vi.advanceTimersByTime(1999);
    expect(store.getSnapshot().toast).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.getSnapshot().toast).toBeNull();
  });

  it("keeps the action and notifies subscribers", () => {
    const store = createToastStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    const onClick = vi.fn();
    store.show("Removed", { action: { label: "Undo", onClick } });
    expect(listener).toHaveBeenCalledTimes(1);
    store.getSnapshot().toast?.action?.onClick();
    expect(onClick).toHaveBeenCalled();
    unsubscribe();
    store.dismiss();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stacks dialog hosts; the most recently opened one is on top", () => {
    const store = createToastStore();
    const a = {} as HTMLElement;
    const b = {} as HTMLElement;
    const offA = store.registerHost(a);
    const offB = store.registerHost(b);
    expect(store.getSnapshot().hosts.at(-1)).toBe(b);
    offB();
    expect(store.getSnapshot().hosts.at(-1)).toBe(a);
    offB(); // idempotent
    offA();
    expect(store.getSnapshot().hosts).toEqual([]);
  });
});
