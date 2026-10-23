import { site } from "@/config/site";

/** The copyright line (IDX agreement §10): Georgia MLS holds the copyright in its listing content. */
export function mlsCopyright(year: number = new Date().getFullYear()): string {
  return `Listing information © ${year} ${site.mls.copyrightHolder}. All rights reserved.`;
}

/** The short copyright notice for cards, tiles and map popups: "© 2026 Georgia MLS". */
export function mlsCopyrightShort(year: number = new Date().getFullYear()): string {
  return `© ${year} ${site.mls.copyrightHolder}`;
}
