import { isNotNull } from "drizzle-orm";
import { SiteFooter } from "@/components/layout/site-footer";
import { db } from "@/db";
import { dataSources } from "@/db/schema";

export default async function SiteLayout({ children }: LayoutProps<"/">) {
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
