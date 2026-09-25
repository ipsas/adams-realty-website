import { clearRecents } from "@/lib/search/recent";
import { isCacheablePage, LIMITS, SW_MESSAGES, type SwMessage, USER_CACHES } from "./protocol";

/**
 * Page-side PWA helpers. Every function is safe without a service worker,
 * Cache Storage or Push (insecure origins, old browsers, private mode) and
 * never throws.
 */

function sw(): ServiceWorkerContainer | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.serviceWorker;
}

function post(message: SwMessage): boolean {
  const controller = sw()?.controller;
  if (!controller) return false;
  try {
    controller.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

function capped(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    work.then(
      () => (clearTimeout(timer), resolve()),
      () => (clearTimeout(timer), resolve()),
    );
  });
}

/**
 * Drops this device's push subscription. Needs no session: the server row
 * gets a 410 on its next send and is deleted then.
 */
export async function unsubscribePush(): Promise<void> {
  try {
    const reg = await sw()?.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    await sub?.unsubscribe();
  } catch {
    // No SW, no push support, or already gone.
  }
}

/**
 * Forgets this user's local data: recents (and the last-search cookie), the
 * pages and images caches, and tells the SW to do the same.
 */
export async function clearUserCaches(): Promise<void> {
  try {
    clearRecents();
  } catch {
    // Storage unavailable: nothing stored.
  }
  post({ type: SW_MESSAGES.CLEAR_USER_DATA });
  try {
    if (typeof caches !== "undefined") {
      await Promise.all(USER_CACHES.map((name) => caches.delete(name)));
    }
  } catch {
    // Cache Storage unavailable.
  }
}

/**
 * Run before authClient.signOut() (and on a user change): unsubscribePush(),
 * then clearUserCaches(), within `maxMs` total so sign-out never hangs. A
 * stuck push service gets at most two thirds of the budget, so local data is
 * still cleared; recents and the SW message go out synchronously in any case.
 */
export async function prepareSignOut(maxMs = 1500): Promise<void> {
  const started = Date.now();
  await capped(unsubscribePush(), (maxMs * 2) / 3);
  await capped(clearUserCaches(), Math.max(0, maxMs - (Date.now() - started)));
}

/**
 * Asks the SW to cache these pages for offline use (e.g. saved homes). Only
 * same-origin PAGE_ALLOW URLs are sent, deduplicated, at most 50. Returns
 * false (a no-op) without an active SW controller.
 */
export function warmPages(urls: readonly string[]): boolean {
  if (!sw()?.controller || typeof location === "undefined") return false;
  const origin = location.origin;
  const paths = new Set<string>();
  for (const u of urls) {
    if (paths.size >= LIMITS.warmPages) break;
    try {
      const url = new URL(u, origin);
      if (isCacheablePage(url, origin)) paths.add(url.pathname + url.search);
    } catch {
      // Skip malformed URLs.
    }
  }
  if (!paths.size) return false;
  return post({ type: SW_MESSAGES.CACHE_PAGES, urls: [...paths] });
}
