import { count } from "drizzle-orm";
import { db } from "@/db";
import { listings } from "@/db/schema";
import { selectCards, withPhotos, type ListingCardData } from "@/lib/listings/card";
import { PAGE_SIZE, type SearchCriteria } from "./params";
import { buildOrderBy, buildWhere } from "./query";

/**
 * Search entry points. Backed by Postgres (full-text + GiST geo index), which
 * comfortably handles a metro MLS (~50–100k listings). If we outgrow it, swap
 * the implementation of these two functions for Typesense/OpenSearch — the
 * rest of the app only depends on these signatures.
 */

export type SearchResult = {
  items: ListingCardData[];
  total: number;
  page: number;
  pageCount: number;
};

export async function searchListings(c: SearchCriteria): Promise<SearchResult> {
  const where = buildWhere(c);
  const [rows, [{ total }]] = await Promise.all([
    selectCards(db)
      .where(where)
      .orderBy(...buildOrderBy(c))
      .limit(PAGE_SIZE)
      .offset((c.page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(listings).where(where),
  ]);
  return {
    items: await withPhotos(db, rows),
    total,
    page: c.page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

export type MapPin = {
  id: string;
  slug: string;
  lat: number;
  lng: number;
  price: number;
  status: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  address: string;
  photo: string | null;
  featured: boolean;
};

export const MAX_PINS = 750;

/** Lightweight pins for every match (not just the current page), capped for payload size. */
export async function searchMapPins(c: SearchCriteria): Promise<MapPin[]> {
  const rows = await db
    .select({
      id: listings.id,
      slug: listings.slug,
      lat: listings.latitude,
      lng: listings.longitude,
      price: listings.listPrice,
      closePrice: listings.closePrice,
      status: listings.status,
      beds: listings.bedrooms,
      baths: listings.bathrooms,
      sqft: listings.livingAreaSqft,
      addressLine1: listings.addressLine1,
      unitNumber: listings.unitNumber,
      city: listings.city,
      hideAddress: listings.hideAddress,
      photo: listings.primaryPhotoUrl,
      featured: listings.isFeatured,
    })
    .from(listings)
    .where(buildWhere(c))
    .orderBy(...buildOrderBy(c))
    .limit(MAX_PINS);

  return rows
    .filter((r) => r.lat !== null && r.lng !== null)
    .map((r) => ({
      id: r.id,
      slug: r.slug,
      lat: r.lat!,
      lng: r.lng!,
      price: r.status === "closed" && r.closePrice ? r.closePrice : r.price,
      status: r.status,
      beds: r.beds,
      baths: r.baths,
      sqft: r.sqft,
      address: r.hideAddress
        ? r.city
        : `${r.addressLine1}${r.unitNumber ? ` #${r.unitNumber}` : ""}, ${r.city}`,
      photo: r.photo,
      featured: r.featured,
    }));
}
