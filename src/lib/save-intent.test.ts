import { describe, expect, it } from "vitest";
import type { KeyValueStorage } from "./local-store";
import { rememberSaveIntent, SAVE_INTENT_MS, takeSaveIntent } from "./save-intent";

function mapStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

const HOME = "0b6f1c1e-5d3a-4c8e-9a1b-2c3d4e5f6a7b";
const OTHER = "1c7a2d2f-6e4b-4d9f-8b2c-3d4e5f6a7b8c";

describe("the save intent behind ?save= (a heart tapped before signing in)", () => {
  it("saves the home this tab's heart tap asked for, once", () => {
    const s = mapStorage();
    rememberSaveIntent(HOME, s, 1_000);
    expect(takeSaveIntent(HOME, s, 5_000)).toBe(true);
    // Used up: reloading or revisiting the address saves nothing more.
    expect(takeSaveIntent(HOME, s, 6_000)).toBe(false);
  });

  it("saves nothing for a ?save= link with no heart tap behind it", () => {
    expect(takeSaveIntent(HOME, mapStorage(), 1_000)).toBe(false);
  });

  it("saves nothing when the link names another home, and the tap's intent is spent", () => {
    const s = mapStorage();
    rememberSaveIntent(HOME, s, 1_000);
    expect(takeSaveIntent(OTHER, s, 2_000)).toBe(false);
    expect(takeSaveIntent(HOME, s, 3_000)).toBe(false);
  });

  it("expires an old tap", () => {
    const s = mapStorage();
    rememberSaveIntent(HOME, s, 1_000);
    expect(takeSaveIntent(HOME, s, 1_000 + SAVE_INTENT_MS + 1)).toBe(false);
  });

  it("treats unavailable or garbled storage as no intent", () => {
    expect(takeSaveIntent(HOME, null, 1_000)).toBe(false);
    const s = mapStorage();
    s.setItem("ar:save-intent", "{not json");
    expect(takeSaveIntent(HOME, s, 1_000)).toBe(false);
    s.setItem("ar:save-intent", JSON.stringify({ id: HOME, at: "soon" }));
    expect(takeSaveIntent(HOME, s, 1_000)).toBe(false);
  });
});
