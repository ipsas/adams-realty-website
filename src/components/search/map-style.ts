/**
 * Base-map style URLs, one per theme. React- and MapLibre-free so it can be unit-tested.
 * Any MapLibre style works; OpenFreeMap needs no API key.
 */

export const DEFAULT_MAP_STYLE_URLS = {
  light: "https://tiles.openfreemap.org/styles/positron",
  dark: "https://tiles.openfreemap.org/styles/dark",
} as const;

export type MapTheme = "light" | "dark";

/**
 * Light: the custom URL, else positron. Dark: the custom dark URL, else the custom light
 * URL (a self-hosted provider must not be bypassed just because the page is dark, which
 * keeps the privacy page's "OpenFreeMap unless NEXT_PUBLIC_MAP_STYLE_URL points elsewhere"
 * true), else OpenFreeMap's dark style.
 */
export function pickMapStyleUrl(
  theme: MapTheme,
  custom: { light?: string; dark?: string },
): string {
  const light = custom.light || undefined;
  const dark = custom.dark || undefined;
  if (theme === "dark") return dark ?? light ?? DEFAULT_MAP_STYLE_URLS.dark;
  return light ?? DEFAULT_MAP_STYLE_URLS.light;
}

/** Written out literally so Next inlines both NEXT_PUBLIC_ variables into the client bundle. */
const CUSTOM = {
  light: process.env.NEXT_PUBLIC_MAP_STYLE_URL,
  dark: process.env.NEXT_PUBLIC_MAP_STYLE_DARK_URL,
};

/** The light style (NEXT_PUBLIC_MAP_STYLE_URL, else positron). */
export const MAP_STYLE_URL = pickMapStyleUrl("light", CUSTOM);
/** The dark style (NEXT_PUBLIC_MAP_STYLE_DARK_URL, else the custom light URL, else OpenFreeMap dark). */
export const MAP_STYLE_DARK_URL = pickMapStyleUrl("dark", CUSTOM);

export function mapStyleUrl(theme: MapTheme): string {
  return theme === "dark" ? MAP_STYLE_DARK_URL : MAP_STYLE_URL;
}
