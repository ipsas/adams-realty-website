import type { listings } from "@/db/schema";

/**
 * The provider-neutral shape every listing feed is normalized into before it
 * touches the database. Adding a new feed (Spark, a vendor's proprietary API,
 * a CSV drop…) means writing one provider that yields these.
 */
export type NormalizedListing = Omit<
  typeof listings.$inferInsert,
  | "id"
  | "sourceId"
  | "slug"
  | "createdAt"
  | "updatedAt"
  | "removedAt"
  | "isFeatured"
  | "isCompanyListing"
  | "listAgentId"
  | "primaryPhotoUrl"
  | "photoCount"
> & {
  /** The listing agent's MLS ID, used to link to our agent profiles. */
  listAgentMlsId: string | null;
  media: NormalizedMedia[];
  openHouses: NormalizedOpenHouse[];
};

export type NormalizedMedia = {
  sourceKey: string | null;
  url: string;
  kind: "photo" | "floor_plan" | "video" | "virtual_tour";
  caption: string | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
};

export type NormalizedOpenHouse = {
  sourceKey: string | null;
  type: "in_person" | "virtual";
  startsAt: Date;
  endsAt: Date;
  remarks: string | null;
};

/** Result of mapping one raw feed record. Skips carry a reason for sync logs. */
export type MapResult =
  | { ok: true; listing: NormalizedListing }
  | { ok: false; listingKey: string | null; reason: MapSkipReason };

export type MapSkipReason =
  | "missing_key"
  | "missing_price"
  | "missing_address"
  | "unsupported_status"
  | "unsupported_property_type"
  /** Seller opted out of internet display (IDX `InternetEntireListingDisplayYN = false`). */
  | "not_displayable";

export interface ListingProvider {
  /** Yields pages of records modified at or after `since` (all records when null), oldest first. */
  fetchUpdates(since: Date | null): AsyncIterable<MapResult[]>;
  /** Every listing key currently in the feed. Keys we hold that are missing get removed. */
  fetchActiveKeys(): Promise<Set<string>>;
}
