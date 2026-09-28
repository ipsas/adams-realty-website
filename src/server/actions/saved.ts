"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { listings, savedListings, savedSearches } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";
import { canShowDetails } from "@/lib/listings/visibility";
import { describeCriteria, parseSearchParams } from "@/lib/search/params";

const uuid = z.string().uuid();

export type ToggleSavedResult =
  { ok: true; saved: boolean } | { ok: false; error: "unauthenticated" | "invalid" };

export async function toggleSavedListing(listingId: string): Promise<ToggleSavedResult> {
  const actor = await getActor();
  if (!can.saveListing(actor) || !actor) return { ok: false, error: "unauthenticated" };
  if (!uuid.safeParse(listingId).success) return { ok: false, error: "invalid" };

  const deleted = await db
    .delete(savedListings)
    .where(and(eq(savedListings.userId, actor.userId), eq(savedListings.listingId, listingId)))
    .returning({ id: savedListings.listingId });
  if (deleted.length) {
    revalidatePath("/saved");
    return { ok: true, saved: false };
  }

  const [exists] = await db
    .select({ fromFeed: listings.fromFeed, status: listings.status, removedAt: listings.removedAt })
    .from(listings)
    .where(eq(listings.id, listingId))
    .limit(1);
  // A feed listing Georgia MLS rules keep off the site can be unsaved, not saved.
  if (!exists || !canShowDetails(exists)) return { ok: false, error: "invalid" };
  await db.insert(savedListings).values({ userId: actor.userId, listingId }).onConflictDoNothing();
  revalidatePath("/saved");
  return { ok: true, saved: true };
}

const frequency = z.enum(["instant", "daily", "weekly", "off"]);

export type SaveSearchResult = { ok: true; id: string } | { ok: false; error: string };

/** Saves the search described by a query string (the same one the search page uses). */
export async function saveSearch(input: {
  query: string;
  name?: string;
  alertFrequency?: string;
}): Promise<SaveSearchResult> {
  const actor = await getActor();
  if (!actor) return { ok: false, error: "unauthenticated" };
  const criteria = parseSearchParams(new URLSearchParams(input.query));
  // Saved searches should follow the market, not a specific results page.
  criteria.page = 1;
  const name = (input.name?.trim() || describeCriteria(criteria)).slice(0, 120);
  const alertFrequency = frequency.catch("daily").parse(input.alertFrequency);
  const [row] = await db
    .insert(savedSearches)
    .values({ userId: actor.userId, name, criteria, alertFrequency })
    .returning({ id: savedSearches.id });
  revalidatePath("/saved");
  return { ok: true, id: row.id };
}

async function ownedSearch(id: string) {
  const actor = await getActor();
  if (!actor || !uuid.safeParse(id).success) return null;
  const [row] = await db
    .select({ id: savedSearches.id, userId: savedSearches.userId })
    .from(savedSearches)
    .where(eq(savedSearches.id, id))
    .limit(1);
  return row && can.manageOwn(actor, row) ? row : null;
}

export async function updateSavedSearchFrequency(id: string, value: string) {
  const row = await ownedSearch(id);
  const parsed = frequency.safeParse(value);
  if (!row || !parsed.success) return { ok: false as const };
  await db
    .update(savedSearches)
    .set({ alertFrequency: parsed.data })
    .where(eq(savedSearches.id, row.id));
  revalidatePath("/saved");
  return { ok: true as const };
}

export async function deleteSavedSearch(id: string) {
  const row = await ownedSearch(id);
  if (!row) return { ok: false as const };
  await db.delete(savedSearches).where(eq(savedSearches.id, row.id));
  revalidatePath("/saved");
  return { ok: true as const };
}
