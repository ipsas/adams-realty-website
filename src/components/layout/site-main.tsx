import type { ReactNode } from "react";
import { db } from "@/db";
import { sourcesWithPublicListings } from "@/lib/listings/active-sources";
import { sourceDisclaimers } from "@/lib/mls-copyright";
import { SiteFooter } from "./site-footer";

/**
 * The page column and footer every site page shares: the (site) layout, and the
 * (alerts) layout while the preview gate is off.
 */
export async function SiteMain({ children }: { children: ReactNode }) {
  // IDX rules: pages that display MLS listings must show the MLS's disclaimer. Only sources
  // with an active listing get one; Georgia MLS's is computed (year, last sync), other
  // sources' stored text is shown as is.
  const disclaimers = sourceDisclaimers(await sourcesWithPublicListings(db));
  return (
    <>
      <main className="flex-1">{children}</main>
      <SiteFooter disclaimer={disclaimers.join(" ") || null} />
    </>
  );
}
