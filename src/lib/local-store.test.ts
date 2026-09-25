import { describe, expect, it, vi } from "vitest";
import {
  type KeyValueStorage,
  readJSON,
  remove,
  STORE_KEYS,
  subscribe,
  writeJSON,
} from "./local-store";

function mapStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
  };
}

const throwing: KeyValueStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
  removeItem: () => {
    throw new Error("SecurityError");
  },
};

describe("local-store", () => {
  it("round-trips JSON and falls back when missing or malformed", () => {
    const s = mapStorage();
    expect(readJSON(STORE_KEYS.searchAsMove, false, s)).toBe(false);
    expect(writeJSON(STORE_KEYS.searchAsMove, true, s)).toBe(true);
    expect(readJSON(STORE_KEYS.searchAsMove, false, s)).toBe(true);
    s.setItem(STORE_KEYS.visitDays, "{oops");
    expect(readJSON(STORE_KEYS.visitDays, [], s)).toEqual([]);
    remove(STORE_KEYS.searchAsMove, s);
    expect(readJSON(STORE_KEYS.searchAsMove, false, s)).toBe(false);
  });

  it("never throws when storage is unavailable", () => {
    expect(readJSON("k", 1, throwing)).toBe(1);
    expect(writeJSON("k", 2, throwing)).toBe(false);
    expect(() => remove("k", throwing)).not.toThrow();
    expect(readJSON("k", 1, null)).toBe(1);
    expect(writeJSON("k", 2, null)).toBe(false);
  });

  it("notifies same-tab subscribers of that key only, until unsubscribed", () => {
    const s = mapStorage();
    const cb = vi.fn();
    const other = vi.fn();
    const off = subscribe(STORE_KEYS.lastSearch, cb);
    subscribe(STORE_KEYS.recentlyViewed, other);
    writeJSON(STORE_KEYS.lastSearch, { href: "/homes", at: 1 }, s);
    remove(STORE_KEYS.lastSearch, s);
    // Even a failed write re-reads, so subscribers never show stale data.
    writeJSON(STORE_KEYS.lastSearch, 1, throwing);
    expect(cb).toHaveBeenCalledTimes(3);
    expect(other).not.toHaveBeenCalled();
    off();
    writeJSON(STORE_KEYS.lastSearch, 2, s);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it("uses ar: keys", () => {
    for (const key of Object.values(STORE_KEYS)) expect(key).toMatch(/^ar:[a-zA-Z]+$/);
  });
});
