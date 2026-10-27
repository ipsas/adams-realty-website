import { beforeEach, describe, expect, it, vi } from "vitest";

// afterResponse hands lead emails to Next's after(), which on Vercel keeps the
// function alive (waitUntil) until they're sent; a failure is logged, not thrown.

const h = vi.hoisted(() => ({ scheduled: [] as Array<() => Promise<void>> }));
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => void h.scheduled.push(fn),
}));

const { afterResponse } = await import("./deliver");

beforeEach(() => {
  h.scheduled = [];
});

describe("afterResponse", () => {
  it("schedules the work with after() instead of running it now", async () => {
    const task = vi.fn(async () => {});
    afterResponse("test", task);
    expect(task).not.toHaveBeenCalled();
    expect(h.scheduled).toHaveLength(1);
    await h.scheduled[0]();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("logs a failure instead of throwing it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    afterResponse("lead emails", async () => {
      throw new Error("provider down");
    });
    await expect(h.scheduled[0]()).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "[lead emails] failed after the response: Error: provider down",
    );
    error.mockRestore();
  });
});
