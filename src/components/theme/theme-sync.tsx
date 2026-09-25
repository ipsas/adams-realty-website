"use client";

import { useLayoutEffect } from "react";
import { watchTheme } from "@/lib/theme";

/**
 * Keeps <html> on the stored appearance after hydration: re-applies it before paint
 * (React's dev remount clears the head script's attribute), follows writes from this
 * and other tabs, and re-syncs pages restored from the back/forward cache.
 * Renders nothing and announces nothing.
 */
export function ThemeSync() {
  useLayoutEffect(() => watchTheme(), []);
  return null;
}
