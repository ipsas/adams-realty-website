import {
  type KeyValueStorage,
  STORE_KEYS,
  browserStorage,
  readJSON,
  remove,
  subscribe,
  writeJSON,
} from "@/lib/local-store";
import { THEME_COLOR_OVERRIDE_ID, THEME_COLORS } from "@/lib/theme-script";

/**
 * Appearance, client side. local-store imports React, so only client components may
 * import this module; the server layout uses src/lib/theme-script.ts instead.
 *
 * "system" (Match my device) is stored as no key and rendered as no data-theme
 * attribute; CSS then follows prefers-color-scheme. Light and Dark are stored as
 * JSON strings and set html[data-theme].
 */

export type ThemePref = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export { THEME_COLORS };

/** A stored value as a preference; anything unexpected means Match my device. */
export function parseThemePref(value: unknown): ThemePref {
  return value === "light" || value === "dark" ? value : "system";
}

export function resolveTheme(pref: ThemePref, systemDark: boolean): ResolvedTheme {
  if (pref !== "system") return pref;
  return systemDark ? "dark" : "light";
}

export function readThemePref(storage: KeyValueStorage | null = browserStorage()): ThemePref {
  return parseThemePref(readJSON<unknown>(STORE_KEYS.theme, null, storage));
}

/**
 * The theme showing right now, read synchronously from storage and the OS (never null,
 * unlike useResolvedTheme during hydration). Browser only. The map uses it at creation so
 * it never starts on the wrong style.
 */
export function readResolvedTheme(
  storage: KeyValueStorage | null = browserStorage(),
  win: Pick<Window, "matchMedia"> | undefined = typeof window === "undefined" ? undefined : window,
): ResolvedTheme {
  const systemDark =
    typeof win?.matchMedia === "function" && win.matchMedia(SYSTEM_DARK_QUERY).matches;
  return resolveTheme(readThemePref(storage), systemDark);
}

/** Saves the choice and notifies subscribers (this tab now, other tabs via `storage`). */
export function writeThemePref(
  pref: ThemePref,
  storage: KeyValueStorage | null = browserStorage(),
): void {
  if (pref === "system") remove(STORE_KEYS.theme, storage);
  else writeJSON(STORE_KEYS.theme, pref, storage);
}

/** The DOM this module touches; tests pass a fake. */
export type ThemeDocument = Pick<
  Document,
  "documentElement" | "head" | "getElementById" | "createElement"
>;
type Frame = (cb: () => void) => void;

const nextFrame: Frame = (cb) => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(cb);
  else setTimeout(cb, 16);
};

/**
 * Turns transitions off until the next frame has been styled, so a theme switch
 * swaps every colour at once instead of fading each one (globals.css).
 */
export function markSwitching(doc: ThemeDocument = document, frame: Frame = nextFrame): void {
  const root = doc.documentElement;
  root.setAttribute("data-theme-switching", "");
  frame(() => frame(() => root.removeAttribute("data-theme-switching")));
}

// Set by WP2's hero (F49) while it is in view; wins over the theme's colour.
let chromeColor: string | null = null;

/**
 * Keeps meta#theme-color-override (first in <head>) in step: the chrome colour when
 * one is set, else the forced theme's canvas, else none, so the media-query pair
 * from the layout's viewport follows the OS.
 */
function syncThemeColor(doc: ThemeDocument): void {
  const forced = doc.documentElement.getAttribute("data-theme");
  const color =
    chromeColor ?? (forced === "light" || forced === "dark" ? THEME_COLORS[forced] : null);
  let meta = doc.getElementById(THEME_COLOR_OVERRIDE_ID);
  if (!color) {
    meta?.remove();
    return;
  }
  if (!meta) {
    meta = doc.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.id = THEME_COLOR_OVERRIDE_ID;
  }
  meta.setAttribute("content", color);
  // (Re)insert first, so it precedes the viewport's theme-color metas.
  if (doc.head.firstChild !== meta) doc.head.insertBefore(meta, doc.head.firstChild);
}

/** Renders `pref`: sets or removes html[data-theme] and the theme-color override. */
export function applyTheme(
  pref: ThemePref,
  doc: ThemeDocument = document,
  frame: Frame = nextFrame,
): void {
  const root = doc.documentElement;
  const next = pref === "system" ? null : pref;
  if (root.getAttribute("data-theme") !== next) {
    markSwitching(doc, frame);
    if (next) root.setAttribute("data-theme", next);
    else root.removeAttribute("data-theme");
  }
  syncThemeColor(doc);
}

/**
 * Overrides the browser chrome colour (WP2's F49 hero); null goes back to the
 * theme's own colour.
 */
export function setChromeColor(color: string | null, doc: ThemeDocument = document): void {
  chromeColor = color;
  syncThemeColor(doc);
}

type ThemeWindow = Pick<Window, "addEventListener" | "removeEventListener" | "matchMedia">;

/**
 * Keeps the page on the stored preference: applies it now (React's dev remount
 * clears attributes the head script set), after a write in this or another tab,
 * and when a page comes back from the back/forward cache, whose frozen page missed
 * any `storage` events. An OS scheme flip needs no DOM change (CSS follows it), only
 * the no-fade marker. Returns the cleanup.
 */
export function watchTheme(
  win: ThemeWindow = window,
  doc: ThemeDocument = document,
  storage: KeyValueStorage | null = browserStorage(),
): () => void {
  const apply = () => applyTheme(readThemePref(storage), doc);
  apply();
  const off = subscribe(STORE_KEYS.theme, apply);
  const onPageShow = (e: Event) => {
    if ((e as PageTransitionEvent).persisted) apply();
  };
  win.addEventListener("pageshow", onPageShow);
  const mql = typeof win.matchMedia === "function" ? win.matchMedia(SYSTEM_DARK_QUERY) : null;
  const onSystemChange = () => markSwitching(doc);
  mql?.addEventListener?.("change", onSystemChange);
  return () => {
    off();
    win.removeEventListener("pageshow", onPageShow);
    mql?.removeEventListener?.("change", onSystemChange);
  };
}
