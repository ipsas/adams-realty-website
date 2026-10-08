import { isNotNull } from "drizzle-orm";
import type { ReactNode } from "react";
import { db } from "@/db";
import { dataSources } from "@/db/schema";
import { SiteFooter } from "./site-footer";

/**
 * The page column and footer every site page shares: the (site) layout, and the
 * (alerts) layout while the preview gate is off.
 */
export async function SiteMain({ children }: { children: ReactNode }) {
  // IDX rules: pages that display MLS listings must show the MLS's disclaimer.
  const disclaimers = await db
    .selectDistinct({ text: dataSources.disclaimer })
    .from(dataSources)
    .where(isNotNull(dataSources.disclaimer));
  return (
    <>
      <main className="flex-1">{children}</main>
      <SiteFooter disclaimer={disclaimers.map((d) => d.text).join(" ") || null} />
    </>
  );
}
