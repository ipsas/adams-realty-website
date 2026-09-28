"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { z } from "zod";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { canShowDetails } from "@/lib/listings/visibility";
import { isBotUserAgent, recordListingView } from "@/lib/listings/views";

const uuid = z.string().uuid();

/**
 * Counts one view of a listing page (Georgia MLS traffic statistics; see
 * src/lib/listings/views.ts). Called by the page's CountView once it is on
 * screen, so crawlers that don't run scripts, and link prefetches, don't count.
 * Anonymous by design: nothing about the visitor is stored.
 */
export async function countListingView(listingId: string): Promise<void> {
  if (!uuid.safeParse(listingId).success) return;
  const h = await headers();
  if (isBotUserAgent(h.get("user-agent"))) return;
  const [l] = await db
    .select({ fromFeed: listings.fromFeed, status: listings.status, removedAt: listings.removedAt })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!l || !canShowDetails(l)) return;
  await recordListingView(db, listingId);
}
