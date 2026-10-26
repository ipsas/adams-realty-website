import type { ReactNode } from "react";
import { db } from "@/db";
import { dataSources } from "@/db/schema";
import { mlsDisclaimer } from "@/lib/mls-copyright";
import { GAMLS_SLUG } from "@/lib/mls/gamls";
import { SiteFooter } from "./site-footer";

/**
 * The page column and footer every site page shares: the (site) layout, and the
 * (alerts) layout while the preview gate is off.
 */
export async function SiteMain({ children }: { children: ReactNode }) {
  // IDX rules: pages that display MLS listings must show the MLS's disclaimer. Georgia MLS's
  // is computed (year, last sync); other sources' stored text is shown as is.
  const sources = await db
    .select({
      slug: dataSources.slug,
      disclaimer: dataSources.disclaimer,
      lastSyncedAt: dataSources.lastSyncedAt,
    })
    .from(dataSources);
  const gamls = sources.find((s) => s.slug === GAMLS_SLUG);
  const disclaimers = new Set([
    mlsDisclaimer(gamls?.lastSyncedAt),
    ...sources.flatMap((s) => (s.slug !== GAMLS_SLUG && s.disclaimer ? [s.disclaimer] : [])),
  ]);
  return (
    <>
      <main className="flex-1">{children}</main>
      <SiteFooter disclaimer={[...disclaimers].join(" ")} />
    </>
  );
}
