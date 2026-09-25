import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STORE_KEYS } from "@/lib/local-store";
import { clearUserCaches, prepareSignOut, unsubscribePush, warmPages } from "./client";

function fakeLocalStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

let posted: unknown[];
let deleted: string[];
let unsubscribe: ReturnType<typeof vi.fn>;
let storage: ReturnType<typeof fakeLocalStorage>;
let cookies: string[];

function install({ controller = true, hangPush = false } = {}) {
  unsubscribe = vi.fn(() => (hangPush ? new Promise(() => {}) : Promise.resolve(true)));
  vi.stubGlobal("navigator", {
    serviceWorker: {
      controller: controller ? { postMessage: (m: unknown) => posted.push(m) } : null,
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => ({ unsubscribe }) },
      }),
    },
  });
  vi.stubGlobal("caches", { delete: async (name: string) => (deleted.push(name), true) });
  vi.stubGlobal("location", { origin: "https://adamsrealty.example", protocol: "https:" });
  vi.stubGlobal("window", {
    localStorage: storage,
    location: { protocol: "https:" },
    addEventListener() {},
    removeEventListener() {},
  });
  vi.stubGlobal("document", {
    set cookie(c: string) {
      cookies.push(c);
    },
  });
}

beforeEach(() => {
  posted = [];
  deleted = [];
  cookies = [];
  storage = fakeLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("without browser APIs", () => {
  it("never throws", async () => {
    vi.stubGlobal("navigator", {});
    await expect(unsubscribePush()).resolves.toBeUndefined();
    await expect(clearUserCaches()).resolves.toBeUndefined();
    await expect(prepareSignOut()).resolves.toBeUndefined();
    expect(warmPages(["/homes/a"])).toBe(false);
  });
});

describe("clearUserCaches", () => {
  it("deletes user caches, tells the SW and clears recents with the cookie", async () => {
    install();
    storage.setItem(STORE_KEYS.recentlyViewed, "[]");
    storage.setItem(STORE_KEYS.lastSearch, JSON.stringify({ href: "/homes?q=A", at: 1 }));
    storage.setItem(STORE_KEYS.uid, "abc");
    await clearUserCaches();
    expect(deleted.sort()).toEqual(["images", "pages"]);
    expect(posted).toEqual([{ type: "CLEAR_USER_DATA" }]);
    expect(storage.map.has(STORE_KEYS.recentlyViewed)).toBe(false);
    expect(storage.map.has(STORE_KEYS.lastSearch)).toBe(false);
    // The user marker belongs to the PWA runtime, which rewrites it itself.
    expect(storage.map.get(STORE_KEYS.uid)).toBe("abc");
    expect(cookies.at(-1)).toMatch(/^ar_last_search=; .*Max-Age=0.*; Secure$/);
  });
});

describe("prepareSignOut", () => {
  it("unsubscribes push, then clears caches", async () => {
    install();
    await prepareSignOut();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(deleted).toHaveLength(2);
  });

  it("still clears local data within 1500ms when push hangs", async () => {
    vi.useFakeTimers();
    install({ hangPush: true });
    let done = false;
    void prepareSignOut().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(posted).toEqual([{ type: "CLEAR_USER_DATA" }]);
    await vi.advanceTimersByTimeAsync(500);
    expect(done).toBe(true);
    expect(deleted).toHaveLength(2);
  });
});

describe("warmPages", () => {
  it("posts same-origin allowlisted paths, deduplicated, at most 50", () => {
    install();
    const urls = [
      "/homes/a",
      "https://adamsrealty.example/homes/a",
      "/dashboard",
      "https://evil.example/homes/b",
      "/account",
      ...Array.from({ length: 60 }, (_, i) => `/homes/h-${i}`),
    ];
    expect(warmPages(urls)).toBe(true);
    const msg = posted[0] as { type: string; urls: string[] };
    expect(msg.type).toBe("CACHE_PAGES");
    expect(msg.urls).toHaveLength(50);
    expect(msg.urls[0]).toBe("/homes/a");
    expect(msg.urls).not.toContain("/dashboard");
    expect(msg.urls.every((u) => u.startsWith("/homes/"))).toBe(true);
  });

  it("is a no-op without a controller", () => {
    install({ controller: false });
    expect(warmPages(["/homes/a"])).toBe(false);
    expect(posted).toEqual([]);
  });
});
