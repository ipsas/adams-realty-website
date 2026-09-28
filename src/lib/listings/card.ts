import { inArray, lt, sql } from "drizzle-orm";
import type { Executor } from "@/db";
import { listingMedia, listings, openHouses } from "@/db/schema";
import { allowedPhotos } from "./visibility";

/**
 * Columns needed to render a listing card. One definition shared by search,
 * featured rows, saved homes and "similar homes", so cards look identical
 * everywhere.
 */
export const cardColumns = {
  id: listings.id,
  slug: listings.slug,
  status: listings.status,
  transactionType: listings.transactionType,
  propertyType: listings.propertyType,
  listPrice: listings.listPrice,
  originalListPrice: listings.originalListPrice,
  closePrice: listings.closePrice,
  closeDate: listings.closeDate,
  listDate: listings.listDate,
  bedrooms: listings.bedrooms,
  bathrooms: listings.bathrooms,
  livingAreaSqft: listings.livingAreaSqft,
  lotSizeSqft: listings.lotSizeSqft,
  addressLine1: listings.addressLine1,
  unitNumber: listings.unitNumber,
  city: listings.city,
  state: listings.state,
  postalCode: listings.postalCode,
  neighborhood: listings.neighborhood,
  hideAddress: listings.hideAddress,
  latitude: listings.latitude,
  longitude: listings.longitude,
  primaryPhotoUrl: listings.primaryPhotoUrl,
  photoCount: listings.photoCount,
  isCompanyListing: listings.isCompanyListing,
  isFeatured: listings.isFeatured,
  listOfficeName: listings.listOfficeName,
  // For the all-in monthly estimate (quickMonthlyCost) on cards and rows.
  taxAnnualAmount: listings.taxAnnualAmount,
  hoaFee: listings.hoaFee,
  hoaFrequency: listings.hoaFrequency,
  hasVirtualTour: sql<boolean>`"listings"."virtual_tour_url" is not null`,
  removedAt: listings.removedAt,
  // Georgia MLS display rules (./visibility.ts).
  fromFeed: listings.fromFeed,
  idxHidden: listings.idxHidden,
  // Written with explicit aliases: Drizzle renders column references inside
  // select fields unqualified, which would make `listing_id = id` self-referential.
  nextOpenHouse: sql<Date | null>`(
    select min(oh.starts_at) from open_houses oh
    where oh.listing_id = "listings"."id" and oh.ends_at > now()
  )`.mapWith(openHouses.startsAt),
};

/** Base query for cards; callers add where/order/limit. */
export function selectCards(db: Executor) {
  return db.select(cardColumns).from(listings);
}

export type CardRow = Awaited<ReturnType<typeof selectCards>>[number];

export type ListingCardData = CardRow & { photos: string[] };

const CARD_PHOTOS = 5;

/**
 * Attaches the first few photo URLs to each card (for the swipeable card
 * carousel): none for a feed listing the rules keep off the site (a saved home
 * that since went off market), the primary one only for sold and off-market
 * feed listings (`allowedPhotos`).
 */
export async function withPhotos(db: Executor, rows: CardRow[]): Promise<ListingCardData[]> {
  if (!rows.length) return [];
  const media = await db
    .select({ listingId: listingMedia.listingId, url: listingMedia.url })
    .from(listingMedia)
    .where(
      sql`${inArray(
        listingMedia.listingId,
        rows.map((r) => r.id),
      )} and ${lt(listingMedia.sortOrder, CARD_PHOTOS)} and ${listingMedia.kind} = 'photo'`,
    )
    .orderBy(listingMedia.listingId, listingMedia.sortOrder);
  const byListing = new Map<string, string[]>();
  for (const m of media) {
    const list = byListing.get(m.listingId) ?? [];
    list.push(m.url);
    byListing.set(m.listingId, list);
  }
  return rows.map((r) => ({
    ...r,
    photos: allowedPhotos(r, byListing.get(r.id) ?? (r.primaryPhotoUrl ? [r.primaryPhotoUrl] : [])),
  }));
}
