import { isNull } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { PrimitivesDemo } from "./primitives-demo";

export const metadata: Metadata = {
  title: "UI primitives (dev)",
  robots: { index: false, follow: false },
};

/**
 * Dev-only playground for the shared mobile primitives (Dialog sheet/fullscreen + history,
 * toasts, popover scrim, SaveButton variants, touch-sized controls).
 * e2e/mobile/foundation.spec.ts drives it through the data-testid hooks in PrimitivesDemo.
 */
export default async function PrimitivesPage(props: PageProps<"/dev/primitives">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { navigated } = await props.searchParams;
  const [first] = await db
    .select({ id: listings.id })
    .from(listings)
    .where(isNull(listings.removedAt))
    .limit(1);

  return (
    <PrimitivesDemo
      listingId={first?.id ?? "00000000-0000-0000-0000-000000000000"}
      navigated={typeof navigated === "string" ? navigated : null}
    />
  );
}
