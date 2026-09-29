"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { listings, savedListings } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";
import { canShowDetails } from "@/lib/listings/visibility";

export type EnsureSavedResult = { ok: true } | { ok: false; error: "unauthenticated" | "invalid" };

/**
 * Saves a home the buyer hearted before signing in (F08). Idempotent: saving an already
 * saved home changes nothing, so a repeated or replayed `save=` never unsaves it. Unknown,
 * removed or no-longer-shown listings are ignored.
 */
export async function ensureSaved(listingId: string): Promise<EnsureSavedResult> {
  const actor = await getActor();
  if (!actor || !can.saveListing(actor)) return { ok: false, error: "unauthenticated" };
  if (!z.string().uuid().safeParse(listingId).success) return { ok: false, error: "invalid" };

  const [row] = await db
    .select({ fromFeed: listings.fromFeed, status: listings.status, removedAt: listings.removedAt })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!row || row.removedAt || !canShowDetails(row)) return { ok: false, error: "invalid" };

  await db.insert(savedListings).values({ userId: actor.userId, listingId }).onConflictDoNothing();
  revalidatePath("/saved");
  return { ok: true };
}
