import { describe, expect, it } from "vitest";
import { backfillUntilDone } from "./keyword-backfill";

/** `fills` is what each pass fills; `left` starts at their sum plus `stuck`. */
function run(
  fills: number[],
  {
    stuck = 0,
    deadline = Infinity,
    clock = () => 0,
  }: { stuck?: number; deadline?: number; clock?: () => number } = {},
) {
  let left = fills.reduce((a, b) => a + b, 0) + stuck;
  let pass = 0;
  const sleeps: number[] = [];
  const lines: [number, number][] = [];
  const result = backfillUntilDone({
    fill: async () => {
      const n = fills[pass++] ?? 0;
      left -= n;
      return n;
    },
    remaining: async () => left,
    deadline,
    now: clock,
    sleep: async (ms) => sleeps.push(ms),
    progress: (filled, remaining) => lines.push([filled, remaining]),
  });
  return { result, sleeps, lines, passes: () => pass };
}

describe("backfillUntilDone", () => {
  it("runs until none remain", async () => {
    const r = run([3, 2]);
    expect(await r.result).toEqual({ filled: 5, remaining: 0 });
    expect(r.lines).toEqual([[3, 2]]);
    expect(r.sleeps).toEqual([]);
  });

  it("does one pass and stops when nothing is missing", async () => {
    const r = run([]);
    expect(await r.result).toEqual({ filled: 0, remaining: 0 });
    expect(r.passes()).toBe(1);
  });

  it("retries a pass that filled nothing a few times, then gives up", async () => {
    const r = run([2], { stuck: 4 });
    expect(await r.result).toEqual({ filled: 2, remaining: 4 });
    expect(r.sleeps).toEqual([1000, 1000, 1000]);
    expect(r.passes()).toBe(5);
  });

  it("goes on after a retry that fills rows", async () => {
    const r = run([1, 0, 2]);
    expect(await r.result).toEqual({ filled: 3, remaining: 0 });
    expect(r.sleeps).toEqual([1000]);
  });

  it("stops at the deadline with rows left", async () => {
    let t = 0;
    const r = run([1, 1, 1], { deadline: 2, clock: () => ++t });
    expect(await r.result).toEqual({ filled: 2, remaining: 1 });
  });
});
