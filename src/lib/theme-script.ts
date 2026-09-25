import { STORE_KEYS } from "@/lib/store-keys";

/**
 * The parts of theming the server layout needs. React-free on purpose: this module
 * is imported by src/app/layout.tsx (a Server Component), so it may import only
 * store-keys. The client helpers live in src/lib/theme.ts.
 */

/** Browser chrome colours; each equals --color-canvas for its theme in globals.css. */
export const THEME_COLORS = { light: "#fbfaf7", dark: "#0f1412" } as const;

/** The forced theme-color meta, first in <head> so it wins over the media-query pair. */
export const THEME_COLOR_OVERRIDE_ID = "theme-color-override";

/**
 * Runs in <head> before first paint. For a stored Light or Dark it sets
 * html[data-theme] and prepends a theme-color meta without a media query; with no
 * preference (Match my device) it does nothing and CSS follows the OS. ES5, and any
 * failure (storage blocked, malformed value) leaves the page on Match my device.
 */
export const THEME_SCRIPT =
  "(function(){try{" +
  "var d=document,r=d.documentElement," +
  `v=JSON.parse(localStorage.getItem(${JSON.stringify(STORE_KEYS.theme)}));` +
  'if(v!=="light"&&v!=="dark")return;' +
  'r.setAttribute("data-theme",v);' +
  'var m=d.createElement("meta");m.name="theme-color";' +
  `m.id=${JSON.stringify(THEME_COLOR_OVERRIDE_ID)};` +
  `m.content=v==="dark"?${JSON.stringify(THEME_COLORS.dark)}:${JSON.stringify(THEME_COLORS.light)};` +
  "d.head.insertBefore(m,d.head.firstChild)" +
  "}catch(e){}})()";
