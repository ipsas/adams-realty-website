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
  | "fromFeed"
  | "publicSince"
  | "keywordTsv"
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

/**
 * What a purge compares: the listings the site keeps showing. Live statuses
 * (active, coming soon, under contract, pending), plus closed sales since
 * `closedSince`, which sold mode and the area guides still show. With
 * `liveOnly`, every stored listing of the source, whatever its status, kept
 * when its key is live or one of the firm's own sales closed since `closedSince`.
 */
export type PurgeScope = {
  /** YYYY-MM-DD: closed listings count only when they closed on or after this date. */
  closedSince: string;
  /**
   * The feed only sends live statuses (`DataSourceConfig.liveOnly`): the feed is
   * asked for those alone, and every stored listing whose key it lacks is removed,
   * except the firm's own sales closed since `closedSince` (OwnClosedFeed.fetchKeys).
   */
  liveOnly?: boolean;
};

/**
 * A place in the feed's update order (ModificationTimestamp, then
 * ListingKey). With a `key`, "just after this record"; with `key: null`,
 * "every record modified at or after `modifiedAt`".
 */
export type FeedPosition = { modifiedAt: Date; key: string | null };

/** One page of updates, and the position of its last record (to resume after it). */
export type UpdatesPage = {
  items: MapResult[];
  /** Null only when no record on the page had a timestamp and key. */
  last: { modifiedAt: Date; key: string } | null;
};

export interface ListingProvider {
  /**
   * Version of the mapping from feed records to NormalizedListing (e.g.
   * RESO_MAPPER_VERSION). When it differs from the one a source last caught up
   * with, the incremental sync rewrites every record once. Absent: never.
   */
  readonly mapperVersion?: number;
  /**
   * Pages of records in (ModificationTimestamp, ListingKey) order, starting at
   * `from` (every record when null). Pages are fetched by keyset (each one
   * asks for the records after the previous page's last), never by offset, so
   * a record changing mid-run can't shift the pages and hide another.
   */
  fetchUpdates(from: FeedPosition | null): AsyncIterable<UpdatesPage>;
  /**
   * Pages of the listing keys the feed still has within `scope`, in key
   * order and fetched by keyset, like fetchUpdates. The purge soft-removes
   * listings we hold in that scope whose key is missing, and only after the
   * last page arrives: a partial key list is never used.
   */
  fetchActiveKeys(scope: PurgeScope): AsyncIterable<string[]>;
  /**
   * The firm's own closed sales, for a live-only feed (whose saved filter keeps
   * closed records out): see OwnClosedFeed. Absent or null: none (not live-only,
   * or no company office IDs).
   */
  readonly ownClosed?: OwnClosedFeed | null;
  /**
   * Optional: the feed's offices with these MLS office IDs (RESO Office
   * resource), in one request; IDs the feed doesn't know are left out. Names
   * the listing office when the feed sends no ListOfficeName (./office-lookup.ts).
   */
  fetchOffices?(ids: string[]): Promise<MlsOffice[]>;
}

/**
 * The listings the firm's own offices listed (list office only) that closed on
 * or after `closedSince` (YYYY-MM-DD), read apart from the main feed: never
 * combined with its live-status filter, never through its cursor. Both read by
 * keyset on ListingKey, like fetchActiveKeys.
 */
export interface OwnClosedFeed {
  /** The records, mapped like the main feed's. `last` is unused (the main cursor stays put). */
  fetchUpdates(closedSince: string): AsyncIterable<UpdatesPage>;
  /** Just their keys, which the live-only purge keeps besides the live ones. */
  fetchKeys(closedSince: string): AsyncIterable<string[]>;
}

/** One office from the feed's Office resource. */
export type MlsOffice = { officeMlsId: string; officeName: string | null };
