"use server";

import { and, eq, gt, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { dataSources, listings, openHouses } from "@/db/schema";
import { authorize, can, ForbiddenError, type Actor } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";
import { formatOpenHouse } from "@/lib/format";
import { zonedDateTime } from "@/lib/time";
import { audit } from "../audit";

// Open houses for manual listings. The MLS sync writes feed listings' open
// houses itself, so these actions are gated by `can.editListing` like the
// listing editor. Times are entered in the market's time zone (site config).

export type OpenHouseInput = {
  date: string;
  startTime: string;
  endTime: string;
  type: string;
  remarks: string;
};

export type OpenHouseResult = {
  ok: boolean;
  message?: string;
  errors?: Partial<Record<keyof OpenHouseInput, string>>;
};

const MAX_HOURS = 12;
const MAX_DAYS_AHEAD = 366;

/** Sold and off-market listings are hidden or final, so they can't be toured. */
const UNSCHEDULABLE = new Set(["closed", "withdrawn", "expired", "canceled"]);

const isSchedulable = (l: { status: string; removedAt: Date | null }) =>
  !l.removedAt && !UNSCHEDULABLE.has(l.status);

const OFF_MARKET_RESULT: OpenHouseResult = {
  ok: false,
  message: "This listing is sold or off market. Change its status before adding open houses.",
};

/** 24-hour HH:MM. */
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Rejects dates like 2026-02-31, which `Date` would roll over into March. */
function isCalendarDate(v: string) {
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const inputSchema = z.object({
  date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date")
    .refine(isCalendarDate, "Choose a valid date"),
  startTime: z.string().trim().regex(TIME, "Choose a start time"),
  endTime: z.string().trim().regex(TIME, "Choose an end time"),
  type: z.enum(["in_person", "virtual"], { message: "Choose in person or virtual" }),
  remarks: z
    .string()
    .trim()
    .max(200, "Keep remarks under 200 characters")
    .transform((v) => v.replace(/\s+/g, " ") || null),
});

async function requireStaff(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new ForbiddenError("Please sign in.");
  authorize(can.viewDashboard(actor));
  return actor;
}

/** Loads the listing and checks the actor may edit it (manual source, own listing or admin). */
async function authorizeListing(actor: Actor, listingId: string) {
  const [row] = await db
    .select({
      id: listings.id,
      slug: listings.slug,
      status: listings.status,
      listAgentId: listings.listAgentId,
      removedAt: listings.removedAt,
      sourceKind: dataSources.kind,
    })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .where(eq(listings.id, listingId))
    .limit(1);
  if (!row) return null;
  authorize(can.editListing(actor, { sourceKind: row.sourceKind, listAgentId: row.listAgentId }));
  return row;
}

function revalidateListing(listingId: string, slug: string) {
  revalidatePath(`/homes/${slug}`);
  revalidatePath("/homes");
  // The homepage counts this week's open houses.
  revalidatePath("/");
  revalidatePath(`/dashboard/listings/${listingId}`);
}

export async function addOpenHouse(
  listingId: string,
  input: OpenHouseInput,
): Promise<OpenHouseResult> {
  const actor = await requireStaff();
  if (!z.string().uuid().safeParse(listingId).success)
    return { ok: false, message: "Listing not found." };
  const listing = await authorizeListing(actor, listingId);
  if (!listing) return { ok: false, message: "Listing not found." };
  if (!isSchedulable(listing)) return OFF_MARKET_RESULT;

  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    const errors: OpenHouseResult["errors"] = {};
    for (const i of parsed.error.issues) {
      const field = String(i.path[0]) as keyof OpenHouseInput;
      errors[field] ??= i.message;
    }
    return { ok: false, errors };
  }
  const d = parsed.data;

  const startsAt = zonedDateTime(d.date, d.startTime);
  const endsAt = zonedDateTime(d.date, d.endTime);
  if (!startsAt || !endsAt) return { ok: false, errors: { date: "Choose a valid date" } };
  if (endsAt <= startsAt)
    return { ok: false, errors: { endTime: "End time must be after the start time" } };
  if (endsAt.getTime() - startsAt.getTime() > MAX_HOURS * 3_600_000)
    return { ok: false, errors: { endTime: `Open houses can run up to ${MAX_HOURS} hours` } };
  const now = Date.now();
  if (startsAt.getTime() <= now)
    return { ok: false, errors: { startTime: "That time has already passed" } };
  if (startsAt.getTime() > now + MAX_DAYS_AHEAD * 86_400_000)
    return { ok: false, errors: { date: "Schedule open houses up to a year ahead" } };

  const result = await db.transaction(async (tx): Promise<OpenHouseResult> => {
    // Serializes with saveListing, which rewrites a listing's open houses under
    // the same lock. Re-check the status too: a save may have just marked it sold.
    const [locked] = await tx
      .select({ status: listings.status, removedAt: listings.removedAt })
      .from(listings)
      .where(eq(listings.id, listingId))
      .for("update");
    if (!locked) return { ok: false, message: "Listing not found." };
    if (!isSchedulable(locked)) return OFF_MARKET_RESULT;
    const [overlap] = await tx
      .select({ startsAt: openHouses.startsAt, endsAt: openHouses.endsAt })
      .from(openHouses)
      .where(
        and(
          eq(openHouses.listingId, listingId),
          lt(openHouses.startsAt, endsAt),
          gt(openHouses.endsAt, startsAt),
        ),
      )
      .limit(1);
    if (overlap)
      return {
        ok: false,
        message: `That overlaps the open house on ${formatOpenHouse(overlap.startsAt, overlap.endsAt)}.`,
      };

    const [created] = await tx
      .insert(openHouses)
      .values({ listingId, type: d.type, startsAt, endsAt, remarks: d.remarks, sourceKey: null })
      .returning({ id: openHouses.id });
    await audit(tx, {
      actorId: actor.userId,
      action: "listing.open_house.add",
      entityType: "listing",
      entityId: listingId,
      changes: {
        openHouseId: created.id,
        type: d.type,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      },
    });
    return { ok: true, message: `Open house added for ${formatOpenHouse(startsAt, endsAt)}.` };
  });

  if (result.ok) revalidateListing(listingId, listing.slug);
  return result;
}

export async function deleteOpenHouse(openHouseId: string): Promise<OpenHouseResult> {
  const actor = await requireStaff();
  if (!z.string().uuid().safeParse(openHouseId).success)
    return { ok: false, message: "Open house not found." };

  const [row] = await db
    .select({
      listingId: openHouses.listingId,
      startsAt: openHouses.startsAt,
      endsAt: openHouses.endsAt,
    })
    .from(openHouses)
    .where(eq(openHouses.id, openHouseId))
    .limit(1);
  // Saving the listing form rewrites open house rows, so a stale id usually means "refresh".
  if (!row)
    return { ok: false, message: "That open house was already changed. Refresh and try again." };

  const listing = await authorizeListing(actor, row.listingId);
  if (!listing) return { ok: false, message: "Listing not found." };

  await db.transaction(async (tx) => {
    await tx
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.id, row.listingId))
      .for("update");
    await tx.delete(openHouses).where(eq(openHouses.id, openHouseId));
    await audit(tx, {
      actorId: actor.userId,
      action: "listing.open_house.delete",
      entityType: "listing",
      entityId: row.listingId,
      changes: {
        openHouseId,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      },
    });
  });

  revalidateListing(row.listingId, listing.slug);
  return { ok: true, message: `Removed the open house on ${formatOpenHouse(row.startsAt)}.` };
}
