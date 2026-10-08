"use client";

import { useLayoutEffect } from "react";
import { setChromeColor } from "@/lib/theme";

/**
 * Keeps the browser's toolbar (theme-color) on `color` while this page is open, also over a
 * stored Light or Dark appearance, whose override meta would otherwise win over the page's
 * viewport colour; the theme's own colour comes back on leaving.
 */
export function ChromeColor({ color }: { color: string }) {
  useLayoutEffect(() => {
    setChromeColor(color);
    return () => setChromeColor(null);
  }, [color]);
  return null;
}
