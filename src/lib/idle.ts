/**
 * Runs `cb` once the browser is idle (after first paint), for non-urgent work
 * such as creating the map or registering the service worker. Uses
 * requestIdleCallback where it exists; iOS Safari lacks it, so there it waits
 * for the next frame and then a macrotask. `timeout` caps the wait either way.
 * Returns a cancel function. A no-op on the server.
 */
export function whenIdle(cb: () => void, opts: { timeout?: number } = {}): () => void {
  if (typeof window === "undefined") return () => {};
  const { timeout } = opts;
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(() => cb(), timeout ? { timeout } : undefined);
    return () => window.cancelIdleCallback(id);
  }
  let done = false;
  let tick: ReturnType<typeof setTimeout> | undefined;
  // Frames don't run in background tabs, so the timeout also races the frame.
  const cap = timeout ? setTimeout(() => run(), timeout) : undefined;
  const frame = window.requestAnimationFrame(() => {
    tick = setTimeout(() => run(), 0);
  });
  function cancel() {
    done = true;
    window.cancelAnimationFrame(frame);
    clearTimeout(tick);
    clearTimeout(cap);
  }
  function run() {
    if (done) return;
    cancel();
    cb();
  }
  return cancel;
}
