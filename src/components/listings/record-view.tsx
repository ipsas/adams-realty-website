"use client";

import { useEffect } from "react";
import { recordView, type ViewedSnapshot } from "@/lib/search/recent";

/**
 * Adds the listing on screen to this device's "Recently viewed" (home page
 * row, install prompt). Renders nothing. Mounted once by the listing page.
 */
export function RecordView({ snapshot }: { snapshot: ViewedSnapshot }) {
  useEffect(() => {
    recordView(snapshot);
  }, [snapshot]);
  return null;
}
