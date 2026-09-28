"use server";

import { and, asc, eq, ne } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  agents,
  dataSources,
  inquiries,
  listingMedia,
  listings,
  openHouses,
  users,
  type ListingFeatures,
} from "@/db/schema";
import { authorize, can, ForbiddenError, type Actor } from "@/lib/auth/permissions";
import { getActor } from "@/lib/auth/session";
import { geocodeAddress } from "@/lib/geocode";
import { LISTINGS_TAG } from "@/lib/listings/cache-tags";
import { upsertListing } from "@/lib/listings/persist";
import { refreshPlaces } from "@/lib/listings/places";
import { SyncFailedError, syncSource } from "@/lib/mls/sync";
import type { NormalizedListing, NormalizedMedia, NormalizedOpenHouse } from "@/lib/mls/types";
import { audit } from "../audit";

async function requireStaff(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw new ForbiddenError("Please sign in.");
  authorize(can.viewDashboard(actor));
  return actor;
}

// ---------------------------------------------------------------------------
// Listings (manual source only — MLS listings are edited in the MLS)
// ---------------------------------------------------------------------------

export type ListingFormState = {
  ok: boolean;
  message?: string;
  errors?: Partial<Record<string, string>>;
  /** Set on a successful save so the form can remount with the stored (normalized) values. */
  savedAt?: number;
};

/** Feature groups the editor exposes. Other groups in `features` (heating, flooring…) are kept as-is. */
const EDITABLE_FEATURES = ["interior", "exterior", "appliances", "parking", "community"] as const;
const MAX_PHOTOS = 60;
/**
 * Room for the photo manager's JSON at its limits (60 × a 2,048-character link
 * and a 200-character caption), with headroom for keys and escaped characters.
 */
const MAX_PHOTOS_FIELD = 300_000;

/** Sold and off-market listings can't be toured, so they keep no upcoming open houses. */
const OFF_MARKET = new Set(["closed", "withdrawn", "expired", "canceled"]);

const int = (min = 0, max = 1_000_000_000) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().int().min(min).max(max).optional(),
  );
const num = (min = 0, max = 1_000_000) =>
  z.preprocess(
    (v) => (v === "" || v === null ? undefined : v),
    z.coerce.number().min(min).max(max).optional(),
  );
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null);
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

/**
 * A comma-separated feature list → trimmed, de-duplicated items. A field the
 * form didn't send stays `undefined` so the stored group is left untouched.
 */
const featureList = z
  .string()
  .max(4_000)
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    const seen = new Set<string>();
    const items: string[] = [];
    for (const part of v.split(/[,;\n]/)) {
      const item = part.replace(/\s+/g, " ").trim().slice(0, 80);
      if (!item || seen.has(item.toLowerCase())) continue;
      seen.add(item.toLowerCase());
      items.push(item);
    }
    return items.slice(0, 40);
  });

const isHttpsUrl = (v: string) => {
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
};

const photoItems = z
  .array(
    z.object({
      url: z
        .string()
        .trim()
        .max(2_048, "Keep the link under 2,048 characters.")
        .refine(isHttpsUrl, "Use a secure https:// link."),
      caption: z
        .string()
        .trim()
        .max(200, "Keep the caption under 200 characters.")
        .nullish()
        .transform((v) => v || null),
    }),
  )
  .max(MAX_PHOTOS, `Add up to ${MAX_PHOTOS} photos.`);

type PhotoInput = z.infer<typeof photoItems>[number];

/**
 * The photo manager posts a JSON array of `{ url, caption }`. A plain list of
 * URLs (one per line, the original format) is still accepted, ignoring
 * anything that isn't an https:// link.
 */
function parsePhotos(
  raw: string | undefined,
): { ok: true; photos: PhotoInput[] } | { ok: false; message: string } {
  const value = (raw ?? "").trim();
  let photos: PhotoInput[];
  if (value.startsWith("[")) {
    let json: unknown;
    try {
      json = JSON.parse(value);
    } catch {
      return {
        ok: false,
        message: "The photo list couldn't be read. Reload the page and try again.",
      };
    }
    const parsed = photoItems.safeParse(json);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      // Name the photo when the problem is with one of them ("Photo 3: …").
      const index = issue.path[0];
      return {
        ok: false,
        message: typeof index === "number" ? `Photo ${index + 1}: ${issue.message}` : issue.message,
      };
    }
    photos = parsed.data;
  } else {
    photos = value
      .split(/\s+/)
      .filter(isHttpsUrl)
      .slice(0, MAX_PHOTOS)
      .map((url) => ({ url, caption: null }));
  }
  const seen = new Set<string>();
  const unique = photos.filter((p) => {
    if (seen.has(p.url)) return false;
    seen.add(p.url);
    return true;
  });
  return { ok: true, photos: unique };
}

const listingSchema = z.object({
  id: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  status: z.enum([
    "coming_soon",
    "active",
    "active_under_contract",
    "pending",
    "closed",
    "withdrawn",
    "expired",
    "canceled",
  ]),
  transactionType: z.enum(["sale", "rent"]),
  propertyType: z.enum([
    "single_family",
    "condo",
    "townhouse",
    "multi_family",
    "manufactured",
    "land",
    "farm_ranch",
    "other",
  ]),
  listPrice: int(1).refine((v) => v !== undefined, "Enter a price"),
  closePrice: int(),
  closeDate: text(10),
  listDate: text(10),
  addressLine1: z.string().trim().min(3, "Enter the street address").max(200),
  unitNumber: text(20),
  city: z.string().trim().min(2, "Enter the city").max(100),
  state: z.string().trim().length(2, "Use the 2-letter state code").toUpperCase(),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, "Enter a 5-digit ZIP"),
  county: text(100),
  neighborhood: text(100),
  latitude: num(-90, 90),
  longitude: num(-180, 180),
  bedrooms: int(0, 50),
  bathroomsFull: int(0, 50),
  bathroomsHalf: int(0, 50),
  livingAreaSqft: int(0, 100_000),
  lotSizeSqft: int(0, 100_000_000),
  yearBuilt: int(1700, 2100),
  garageSpaces: int(0, 50),
  hoaFee: int(0, 100_000),
  taxAnnualAmount: int(0, 10_000_000),
  headline: text(140),
  description: text(10_000),
  virtualTourUrl: z
    .string()
    .trim()
    .url()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  photos: z
    .string()
    .max(MAX_PHOTOS_FIELD, "The photo list is too long to save. Remove some photos and try again.")
    .optional(),
  features_interior: featureList,
  features_exterior: featureList,
  features_appliances: featureList,
  features_parking: featureList,
  features_community: featureList,
  listAgentId: z
    .string()
    .uuid()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  hasPool: checkbox,
  isWaterfront: checkbox,
  hasView: checkbox,
  hasBasement: checkbox,
  isNewConstruction: checkbox,
  isFeatured: checkbox,
});

export async function saveListing(
  _prev: ListingFormState,
  form: FormData,
): Promise<ListingFormState> {
  const actor = await requireStaff();
  const parsed = listingSchema.safeParse(Object.fromEntries(form.entries()));
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const i of parsed.error.issues) errors[String(i.path[0])] ??= i.message;
    return { ok: false, errors, message: "Please fix the highlighted fields." };
  }
  const d = parsed.data;
  const photoList = parsePhotos(d.photos);
  if (!photoList.ok)
    return {
      ok: false,
      errors: { photos: photoList.message },
      message: "Please fix the highlighted fields.",
    };

  const [source] = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.kind, "manual"))
    .limit(1);
  if (!source) return { ok: false, message: "No manual data source is configured." };

  let existing: typeof listings.$inferSelect | undefined;
  if (d.id) {
    [existing] = await db.select().from(listings).where(eq(listings.id, d.id)).limit(1);
    if (!existing) return { ok: false, message: "Listing not found." };
    authorize(
      can.editListing(actor, {
        sourceKind: existing.sourceId === source.id ? "manual" : "reso_web_api",
        listAgentId: existing.listAgentId,
      }),
    );
  } else {
    authorize(can.createListing(actor));
  }

  // Agents always list as themselves; admins may assign any agent.
  const listAgentId =
    actor.role === "admin" ? (d.listAgentId ?? existing?.listAgentId ?? null) : actor.agentId;
  const [agent] = listAgentId
    ? await db.select().from(agents).where(eq(agents.id, listAgentId)).limit(1)
    : [];

  let { latitude, longitude } = d;
  let geocodeNote = "";
  if (latitude === undefined || longitude === undefined) {
    const addressChanged =
      !existing || existing.addressLine1 !== d.addressLine1 || existing.postalCode !== d.postalCode;
    const found = addressChanged
      ? await geocodeAddress(`${d.addressLine1}, ${d.city}, ${d.state} ${d.postalCode}`)
      : existing?.latitude != null && existing?.longitude != null
        ? { lat: existing.latitude, lng: existing.longitude }
        : null;
    latitude = found?.lat;
    longitude = found?.lng;
    if (!found)
      geocodeNote = " We couldn't place it on the map — add latitude/longitude to show it there.";
  }

  // Only the editable groups change; anything else on file (heating, flooring…) is kept.
  const features: ListingFeatures = { ...existing?.features };
  for (const group of EDITABLE_FEATURES) {
    const items = d[`features_${group}`];
    if (items === undefined) continue;
    if (items.length) features[group] = items;
    else delete features[group];
  }

  const baths =
    d.bathroomsFull !== undefined || d.bathroomsHalf !== undefined
      ? (d.bathroomsFull ?? 0) + 0.5 * (d.bathroomsHalf ?? 0)
      : null;

  const normalized: NormalizedListing = {
    listingKey: existing?.listingKey ?? `ADAMS-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    mlsNumber: existing?.mlsNumber ?? null,
    status: d.status,
    transactionType: d.transactionType,
    propertyType: d.propertyType,
    propertySubType: existing?.propertySubType ?? null,
    listPrice: d.listPrice!,
    originalListPrice: existing?.originalListPrice ?? d.listPrice!,
    closePrice: d.closePrice ?? null,
    listDate: d.listDate ?? existing?.listDate ?? new Date().toISOString().slice(0, 10),
    closeDate: d.closeDate,
    bedrooms: d.bedrooms ?? null,
    bathroomsFull: d.bathroomsFull ?? null,
    bathroomsHalf: d.bathroomsHalf ?? null,
    bathrooms: baths,
    livingAreaSqft: d.livingAreaSqft ?? null,
    lotSizeSqft: d.lotSizeSqft ?? null,
    yearBuilt: d.yearBuilt ?? null,
    stories: existing?.stories ?? null,
    garageSpaces: d.garageSpaces ?? null,
    hoaFee: d.hoaFee ?? null,
    hoaFrequency: d.hoaFee ? "monthly" : null,
    taxAnnualAmount: d.taxAnnualAmount ?? null,
    taxYear: existing?.taxYear ?? null,
    addressLine1: d.addressLine1,
    unitNumber: d.unitNumber,
    city: d.city,
    state: d.state,
    postalCode: d.postalCode,
    county: d.county,
    neighborhood: d.neighborhood,
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    hideAddress: false,
    headline: d.headline,
    description: d.description,
    features,
    schools: existing?.schools ?? {},
    hasPool: d.hasPool,
    isWaterfront: d.isWaterfront,
    hasView: d.hasView,
    hasBasement: d.hasBasement,
    isNewConstruction: d.isNewConstruction,
    isSingleStory: existing?.isSingleStory ?? false,
    virtualTourUrl: d.virtualTourUrl ?? null,
    videoUrl: null,
    listAgentMlsId: null,
    listAgentName: agent?.name ?? null,
    listAgentPhone: agent?.phone ?? null,
    listAgentEmail: agent?.email ?? null,
    listOfficeName: "Adams Realty",
    listOfficeMlsId: null,
    sourceModifiedAt: new Date(),
    statusChangedAt:
      existing && existing.status !== d.status
        ? new Date()
        : (existing?.statusChangedAt ?? new Date()),
    // Filled in inside the transaction below.
    media: [],
    openHouses: [],
  };

  const photoMedia: NormalizedMedia[] = photoList.photos.map((p, i) => ({
    sourceKey: null,
    url: p.url,
    kind: "photo",
    caption: p.caption,
    width: null,
    height: null,
    sortOrder: i,
  }));

  let droppedOpenHouses = 0;
  const saved = await db.transaction(async (tx) => {
    // upsertListing replaces a listing's media and open houses with what it's
    // given. The form edits photos only, so carry over everything else. The row
    // lock serializes with the open house actions so one added meanwhile isn't lost.
    let keptMedia: NormalizedMedia[] = [];
    let keptOpenHouses: NormalizedOpenHouse[] = [];
    if (existing) {
      await tx
        .select({ id: listings.id })
        .from(listings)
        .where(eq(listings.id, existing.id))
        .for("update");
      const otherMedia = await tx
        .select({
          sourceKey: listingMedia.sourceKey,
          url: listingMedia.url,
          kind: listingMedia.kind,
          caption: listingMedia.caption,
          width: listingMedia.width,
          height: listingMedia.height,
        })
        .from(listingMedia)
        .where(and(eq(listingMedia.listingId, existing.id), ne(listingMedia.kind, "photo")))
        .orderBy(asc(listingMedia.sortOrder));
      keptMedia = otherMedia.map((m, i) => ({ ...m, sortOrder: photoMedia.length + i }));
      const opens = await tx
        .select({
          sourceKey: openHouses.sourceKey,
          type: openHouses.type,
          startsAt: openHouses.startsAt,
          endsAt: openHouses.endsAt,
          remarks: openHouses.remarks,
        })
        .from(openHouses)
        .where(eq(openHouses.listingId, existing.id))
        .orderBy(asc(openHouses.startsAt));
      // Going sold or off market cancels open houses that haven't ended; past ones stay as history.
      const now = new Date();
      keptOpenHouses = OFF_MARKET.has(d.status) ? opens.filter((o) => o.endsAt <= now) : opens;
      droppedOpenHouses = opens.length - keptOpenHouses.length;
    }

    const result = await upsertListing(
      tx,
      { id: source.id, slug: source.slug, kind: "manual", config: source.config },
      { ...normalized, media: [...photoMedia, ...keptMedia], openHouses: keptOpenHouses },
      { listAgentId, isFeatured: can.featureListing(actor) ? d.isFeatured : undefined },
    );
    await audit(tx, {
      actorId: actor.userId,
      action: existing ? "listing.update" : "listing.create",
      entityType: "listing",
      entityId: result.id,
      changes: {
        status: d.status,
        listPrice: d.listPrice,
        ...(droppedOpenHouses > 0 && { openHousesRemoved: droppedOpenHouses }),
      },
    });
    return result;
  });

  await listingsChanged();
  revalidatePath("/dashboard/listings");
  revalidatePath("/homes");
  if (!existing) redirect(`/dashboard/listings/${saved.id}?created=1`);
  revalidatePath(`/homes/${existing.slug}`);
  revalidatePath(`/dashboard/listings/${existing.id}`);
  let openHouseNote = "";
  if (droppedOpenHouses > 0) {
    // The homepage counts this week's open houses.
    revalidatePath("/");
    openHouseNote = ` ${
      droppedOpenHouses === 1
        ? "Its upcoming open house was"
        : `Its ${droppedOpenHouses} upcoming open houses were`
    } taken off the site because the listing is ${d.status === "closed" ? "sold" : "off market"}.`;
  }
  return {
    ok: true,
    message: `Listing saved.${openHouseNote}${geocodeNote}`,
    savedAt: Date.now(),
  };
}

export async function deleteListing(id: string) {
  const actor = await requireStaff();
  const [row] = await db
    .select({ id: listings.id, listAgentId: listings.listAgentId, kind: dataSources.kind })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .where(eq(listings.id, id))
    .limit(1);
  if (!row) return;
  authorize(can.deleteListing(actor, { sourceKind: row.kind, listAgentId: row.listAgentId }));
  await db.transaction(async (tx) => {
    await tx.delete(listings).where(eq(listings.id, id));
    await audit(tx, {
      actorId: actor.userId,
      action: "listing.delete",
      entityType: "listing",
      entityId: id,
    });
  });
  await listingsChanged();
  revalidatePath("/dashboard/listings");
  redirect("/dashboard/listings");
}

/**
 * After a listing write: expire the cached listing data (home page stats,
 * featured homes, area guides) so the next request reads fresh rows, and
 * rebuild the autocomplete places.
 */
async function listingsChanged() {
  updateTag(LISTINGS_TAG);
  await refreshPlaces(db).catch((e) => console.error("Refreshing autocomplete places failed:", e));
}

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

const inquiryStatus = z.enum(["new", "contacted", "qualified", "closed", "spam"]);

export async function updateInquiryStatus(id: string, status: string) {
  const actor = await requireStaff();
  const parsed = inquiryStatus.safeParse(status);
  if (!parsed.success) return { ok: false as const };
  const [lead] = await db
    .select({ agentId: inquiries.agentId })
    .from(inquiries)
    .where(eq(inquiries.id, id))
    .limit(1);
  if (!lead) return { ok: false as const };
  authorize(can.updateInquiry(actor, lead));
  await db.update(inquiries).set({ status: parsed.data }).where(eq(inquiries.id, id));
  revalidatePath("/dashboard/leads");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

export async function assignInquiry(id: string, agentId: string) {
  const actor = await requireStaff();
  authorize(can.assignInquiry(actor));
  const target = agentId === "" ? null : z.string().uuid().parse(agentId);
  await db.transaction(async (tx) => {
    await tx.update(inquiries).set({ agentId: target }).where(eq(inquiries.id, id));
    await audit(tx, {
      actorId: actor.userId,
      action: "inquiry.assign",
      entityType: "inquiry",
      entityId: id,
      changes: { agentId: target },
    });
  });
  revalidatePath("/dashboard/leads");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Users & roles (admin)
// ---------------------------------------------------------------------------

const role = z.enum(["user", "agent", "admin"]);

export async function changeUserRole(userId: string, newRole: string) {
  const actor = await requireStaff();
  const parsedRole = role.parse(newRole);
  const [target] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { ok: false as const, message: "User not found." };
  authorize(can.changeRole(actor, { userId: target.id, role: target.role }));
  await db.transaction(async (tx) => {
    await tx.update(users).set({ role: parsedRole }).where(eq(users.id, userId));
    // Demoted to shopper: unlink any agent profile so they lose listing/lead access.
    if (parsedRole === "user")
      await tx.update(agents).set({ userId: null }).where(eq(agents.userId, userId));
    await audit(tx, {
      actorId: actor.userId,
      action: "user.role",
      entityType: "user",
      entityId: userId,
      changes: { from: target.role, to: parsedRole },
    });
  });
  revalidatePath("/dashboard/users");
  return { ok: true as const };
}

export async function linkAgentProfile(userId: string, agentId: string) {
  const actor = await requireStaff();
  authorize(can.manageAgents(actor));
  await db.transaction(async (tx) => {
    await tx.update(agents).set({ userId: null }).where(eq(agents.userId, userId));
    if (agentId) {
      const id = z.string().uuid().parse(agentId);
      await tx.update(agents).set({ userId }).where(eq(agents.id, id));
    }
    await audit(tx, {
      actorId: actor.userId,
      action: "agent.link",
      entityType: "user",
      entityId: userId,
      changes: { agentId: agentId || null },
    });
  });
  revalidatePath("/dashboard/users");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Data feeds (admin)
// ---------------------------------------------------------------------------

export async function runSourceSync(sourceId: string) {
  const actor = await requireStaff();
  authorize(can.manageDataSources(actor));
  const [source] = await db
    .select({ id: dataSources.id })
    .from(dataSources)
    .where(and(eq(dataSources.id, sourceId), eq(dataSources.kind, "reso_web_api")))
    .limit(1);
  if (!source) return { ok: false as const, message: "Only MLS feeds can be synced." };
  try {
    // Same budget as the cron (this action runs in a function with a time limit too).
    const result = await syncSource(source.id, { deadline: Date.now() + 240_000 });
    if (result.changed) updateTag(LISTINGS_TAG);
    revalidatePath("/dashboard/sources");
    const message =
      result.status === "skipped"
        ? "A sync of this feed is already running."
        : result.status === "partial"
          ? `Updated ${result.upserted} listings before the time limit; the next sync continues from there.`
          : `Synced: ${result.upserted} updated, ${result.unchanged} unchanged.`;
    return { ok: result.status !== "skipped", message };
  } catch (e) {
    // Pages written before the failure are live: refresh the caches for them.
    if (e instanceof SyncFailedError && e.changed) updateTag(LISTINGS_TAG);
    revalidatePath("/dashboard/sources");
    return { ok: false as const, message: e instanceof Error ? e.message : "Sync failed." };
  }
}
