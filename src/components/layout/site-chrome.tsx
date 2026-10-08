"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { standsAlone } from "@/lib/preview-gate";

/**
 * The root layout's chrome (header, demo bar, tab bar), left out on the pages that stand
 * alone (`standsAlone`: /preview, and while `gated` the alert emails' pages): not hidden, not
 * rendered, so those pages carry no links into the site. No wrapper element, so the header's
 * sticky positioning is unchanged. `gated`: the preview gate is on (`previewPassword()`).
 */
export function SiteChrome({ children, gated }: { children: ReactNode; gated: boolean }) {
  return standsAlone(usePathname(), gated) ? null : children;
}
