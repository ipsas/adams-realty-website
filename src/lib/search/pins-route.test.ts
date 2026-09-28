import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
const { MAX_PINS, walkPins } = await import("./service");

// When a location search's pins walk the order index instead of collecting
// every match: only when the walk reads at most half as many rows as there
// are matches. Row counts from adams_perf (Postgres's estimates).
describe("walkPins", () => {
  it("walks for a place whose homes are common along the order", () => {
    // Sold homes in Atlanta: ~22.5k of 150k; the walk reads ~5k rows.
    expect(walkPins(22_500, 150_000)).toBe(true);
    // Homes for sale in Atlanta: ~10k of 45k.
    expect(walkPins(10_000, 45_000)).toBe(true);
  });

  it("collects for a place whose homes are rare along the order", () => {
    // Sold homes in Savannah: ~7.9k of 150k; a walk reads ~14k rows (70–130 ms measured).
    expect(walkPins(7_900, 150_000)).toBe(false);
    // Peachtree for sale: ~5.5k of 45k.
    expect(walkPins(5_500, 45_000)).toBe(false);
  });

  it("collects when there are fewer matches than pins, and when there are none", () => {
    expect(walkPins(MAX_PINS - 1, 45_000)).toBe(false);
    expect(walkPins(0, 45_000)).toBe(false);
  });

  it("walks when nearly everything matches", () => {
    expect(walkPins(44_000, 45_000)).toBe(true);
  });
});
