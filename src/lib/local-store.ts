import { useCallback, useState, useSyncExternalStore } from "react";

/**
 * Per-device conveniences in localStorage (recent searches, recently viewed,
 * install-card state…). Nothing here is authoritative: every access is wrapped
 * so private mode, a full quota or disabled storage just means "no data".
 *
 * Writes go through writeJSON/remove so components using useLocalValue in the
 * same tab re-render; other tabs are covered by the `storage` event.
 */

/** Every localStorage key the app uses. Add new keys here (lead-owned). */
export const STORE_KEYS = {
  recentSearches: "ar:recentSearches",
  lastSearch: "ar:lastSearch",
  recentlyViewed: "ar:recentlyViewed",
  searchAsMove: "ar:searchAsMove",
  installDismissedAt: "ar:installDismissedAt",
  visitDays: "ar:visitDays",
  uid: "ar:uid",
} as const;
export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS];

/** The slice of the Storage API we use; tests pass a Map-backed fake. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** window.localStorage, or null on the server or when access throws. */
export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function readRaw(key: string, storage: KeyValueStorage | null): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Parsed JSON at `key`, or `fallback` when missing, unreadable or malformed. Not validated. */
export function readJSON<T>(
  key: string,
  fallback: T,
  storage: KeyValueStorage | null = browserStorage(),
): T {
  const raw = readRaw(key, storage);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Stores `value` as JSON. Returns false when storage is unavailable or full. */
export function writeJSON(
  key: string,
  value: unknown,
  storage: KeyValueStorage | null = browserStorage(),
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  } finally {
    emit(key);
  }
}

export function remove(key: string, storage: KeyValueStorage | null = browserStorage()): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Nothing to clean up if storage is unavailable.
  } finally {
    emit(key);
  }
}

const listeners = new Map<string, Set<() => void>>();

function emit(key: string) {
  listeners.get(key)?.forEach((cb) => cb());
}

/** Calls `cb` when `key` changes in this tab (via this module) or in another tab. */
export function subscribe(key: string, cb: () => void): () => void {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(cb);
  const onStorage = (e: StorageEvent) => {
    // key === null means another tab called localStorage.clear().
    if (e.key === key || e.key === null) cb();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    set.delete(cb);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

// Parsed values keyed by their raw string, so snapshots keep a stable identity.
const parsed = new Map<string, { raw: string; value: unknown }>();
const MALFORMED = Symbol("malformed");

/**
 * The JSON value at `key`, kept in sync across components and tabs. Renders
 * `fallback` on the server and during hydration, then the stored value. The
 * result is not validated: sanitize it (see src/lib/search/recent.ts) before use.
 * Update it with writeJSON/remove.
 */
export function useLocalValue<T>(key: string, fallback: T): T {
  // The first fallback is kept so an inline `[]` doesn't change the snapshot every render.
  const [initial] = useState(fallback);
  const onChange = useCallback((cb: () => void) => subscribe(key, cb), [key]);
  return useSyncExternalStore(
    onChange,
    () => {
      const raw = readRaw(key, browserStorage());
      if (raw === null) return initial;
      let entry = parsed.get(key);
      if (entry?.raw !== raw) {
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          value = MALFORMED;
        }
        entry = { raw, value };
        parsed.set(key, entry);
      }
      return entry.value === MALFORMED ? initial : (entry.value as T);
    },
    () => initial,
  );
}
