import { sql, type AnyColumn, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgMaterializedView,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  dataSourceKind,
  listingEventType,
  listingStatus,
  mediaKind,
  openHouseType,
  propertyType,
  syncMode,
  syncStatus,
  transactionType,
} from "./enums";
import { agents } from "./people";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

// Partial-index predicates: each is the WHERE clause `buildConditions`
// (src/lib/search/query.ts) sends for a search mode, so the planner can prove
// the query implies it.
const FOR_SALE = sql.raw(
  `"removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon')`,
);
const LIVE_SALE = sql.raw(
  `"removed_at" is null and "transaction_type" = 'sale' and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending')`,
);
const RENT = sql.raw(
  `"removed_at" is null and "transaction_type" = 'rent' and "status" = 'active'`,
);
/** Location autocomplete's scope (`getLocationSuggestions`): every listing still on the market. */
const LIVE = sql.raw(
  `"removed_at" is null and "status" in ('active', 'coming_soon', 'active_under_contract', 'pending')`,
);
const SOLD = sql.raw(
  `"removed_at" is null and "transaction_type" = 'sale' and "status" = 'closed'`,
);

/** `normalizedSql` from src/lib/areas/match.ts, for expression indexes. */
function normalized(column: AnyColumn): SQL {
  return sql`btrim(regexp_replace(lower(${column}), '[^a-z0-9]+', ' ', 'g'))`;
}

/**
 * Where a listing came from. Every listing belongs to exactly one source.
 *
 * - `manual`: entered by our own agents in the dashboard (editable here).
 * - `reso_web_api`: an MLS/IDX feed. These rows are a read-only mirror; the
 *   MLS is the system of record, and IDX rules govern how we display them
 *   (attribution, disclaimer, freshness). Credentials live in env vars, never
 *   in this table — `config.credentialsEnvPrefix` names which ones.
 */
export const dataSources = pgTable("data_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  kind: dataSourceKind("kind").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  config: jsonb("config").$type<DataSourceConfig>().notNull().default({}),
  /** IDX disclaimer the MLS requires on every page showing its listings. */
  disclaimer: text("disclaimer"),
  /** High-water mark of `ModificationTimestamp` seen so far (incremental sync). */
  syncCursor: timestamp("sync_cursor", { withTimezone: true }),
  /**
   * ListingKey of the last record written, while a run is partway through the
   * feed: the next run continues right after (sync_cursor, key). Null once a
   * run caught up; the next one then re-reads from a little before the cursor
   * (UPDATE_LOOKBACK_MS in src/lib/mls/sync-engine.ts).
   */
  syncCursorKey: text("sync_cursor_key"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DataSourceConfig = {
  /** RESO Web API base URL, e.g. https://api.bridgedataoutput.com/api/v2/OData/actris */
  baseUrl?: string;
  /** OData resource holding listings. Usually "Property". */
  resource?: string;
  /** Extra OData $filter clause, e.g. "PropertyType eq 'Residential'". */
  filter?: string;
  /**
   * The saved `filter` already restricts the feed to live statuses (active, coming soon,
   * under contract, pending). The purge then treats every stored row of the source as in
   * scope, so closed or off-market rows the feed no longer returns get removed, and
   * fetchActiveKeys asks only for live statuses. Absent/false: closed sales from the last
   * year stay in scope too (other sources).
   */
  liveOnly?: boolean;
  /**
   * Written by the sync, not configured: the provider's mapper version (RESO_MAPPER_VERSION)
   * of the last run that rewrote every record and caught up. A different current version
   * makes the next incremental run rewrite every record again (sync-engine.ts).
   */
  mapperVersion?: number;
  /** Written by the sync: a rewrite for this mapper version stopped partway; the next run resumes it. */
  remappingTo?: number;
  /** Env var prefix holding credentials: `${prefix}_TOKEN` or `${prefix}_CLIENT_ID`/`_CLIENT_SECRET`. */
  credentialsEnvPrefix?: string;
  /** OAuth2 token URL when the feed uses client-credentials auth. */
  tokenUrl?: string;
  /** MLS office IDs that belong to our brokerage; their listings get `isCompanyListing`. */
  companyOfficeIds?: string[];
  /** $top for the purge's key download (default 1000). Bridge caps $top at 200. */
  keyPageSize?: number;
  /**
   * OData $expand value for the updates download (default "Media,OpenHouse"). "" sends no
   * $expand, e.g. Bridge, which returns Media inline and rejects $expand.
   */
  expand?: string;
};

export type ListingFeatures = {
  interior?: string[];
  exterior?: string[];
  appliances?: string[];
  heating?: string[];
  cooling?: string[];
  parking?: string[];
  flooring?: string[];
  community?: string[];
  utilities?: string[];
  view?: string[];
  construction?: string[];
  lot?: string[];
};

export type ListingSchools = {
  district?: string;
  elementary?: string;
  middle?: string;
  high?: string;
};

export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "restrict" }),
    /** Unique key within the source (RESO `ListingKey`). */
    listingKey: text("listing_key").notNull(),
    /** Public MLS number (RESO `ListingId`). */
    mlsNumber: text("mls_number"),
    slug: text("slug").notNull().unique(),

    status: listingStatus("status").notNull(),
    transactionType: transactionType("transaction_type").notNull().default("sale"),
    propertyType: propertyType("property_type").notNull(),
    /** Raw subtype label from the feed, shown as-is ("Single Family Residence"). */
    propertySubType: text("property_sub_type"),

    /** Whole dollars. Monthly rent when `transactionType = 'rent'`. */
    listPrice: integer("list_price").notNull(),
    originalListPrice: integer("original_list_price"),
    closePrice: integer("close_price"),
    listDate: date("list_date", { mode: "string" }),
    closeDate: date("close_date", { mode: "string" }),

    bedrooms: smallint("bedrooms"),
    bathroomsFull: smallint("bathrooms_full"),
    bathroomsHalf: smallint("bathrooms_half"),
    /** Full + 0.5 × half, denormalized for filtering and display. */
    bathrooms: real("bathrooms"),
    livingAreaSqft: integer("living_area_sqft"),
    lotSizeSqft: integer("lot_size_sqft"),
    yearBuilt: smallint("year_built"),
    stories: smallint("stories"),
    garageSpaces: smallint("garage_spaces"),

    hoaFee: integer("hoa_fee"),
    hoaFrequency: text("hoa_frequency").$type<"monthly" | "quarterly" | "annually">(),
    taxAnnualAmount: integer("tax_annual_amount"),
    taxYear: smallint("tax_year"),

    addressLine1: text("address_line1").notNull(),
    unitNumber: text("unit_number"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    postalCode: text("postal_code").notNull(),
    county: text("county"),
    neighborhood: text("neighborhood"),
    /**
     * RESO WaterBodyName: the lake or river a waterfront property is on.
     * Feeds put the subdivision in `neighborhood`, so this is where a lake name
     * like "Lake Hartwell" lives on real MLS data.
     */
    waterBodyName: text("water_body"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    /** Some MLSs let sellers suppress the street address on IDX sites. */
    hideAddress: boolean("hide_address").notNull().default(false),

    headline: text("headline"),
    description: text("description"),
    features: jsonb("features").$type<ListingFeatures>().notNull().default({}),
    schools: jsonb("schools").$type<ListingSchools>().notNull().default({}),

    // Promoted to columns because they are search filters.
    hasPool: boolean("has_pool").notNull().default(false),
    isWaterfront: boolean("is_waterfront").notNull().default(false),
    hasView: boolean("has_view").notNull().default(false),
    hasBasement: boolean("has_basement").notNull().default(false),
    isNewConstruction: boolean("is_new_construction").notNull().default(false),
    isSingleStory: boolean("is_single_story").notNull().default(false),

    virtualTourUrl: text("virtual_tour_url"),
    videoUrl: text("video_url"),
    primaryPhotoUrl: text("primary_photo_url"),
    photoCount: smallint("photo_count").notNull().default(0),

    // Attribution. IDX rules require showing the listing brokerage.
    listAgentId: uuid("list_agent_id").references(() => agents.id, { onDelete: "set null" }),
    listAgentName: text("list_agent_name"),
    listAgentPhone: text("list_agent_phone"),
    listAgentEmail: text("list_agent_email"),
    listOfficeName: text("list_office_name"),
    listOfficeMlsId: text("list_office_mls_id"),
    /**
     * Georgia MLS Exhibit C "mandatory inclusion" fields, shown on the listing
     * page when the feed sends them (src/lib/mls/reso/mapper.ts): the
     * attribution contact, whether the listing broker has a variable
     * commission arrangement, and buyer-agency compensation with its comments
     * (the two are only ever shown together).
     */
    attributionPhone: text("attribution_phone"),
    attributionEmail: text("attribution_email"),
    variableCompensation: boolean("variable_compensation"),
    buyerAgencyCompensation: text("buyer_agency_compensation"),
    compensationComments: text("compensation_comments"),
    /**
     * The row came from an MLS feed (its source's kind isn't `manual`), so
     * Georgia MLS IDX display rules apply to it (src/lib/listings/visibility.ts).
     * Set by upsertListings from the source.
     */
    fromFeed: boolean("from_feed").notNull().default(false),
    /**
     * Listings the public never sees: Coming Soon, Withdrawn (On Hold maps
     * here), Expired or Canceled. Georgia MLS forbids showing its feed
     * listings in these statuses, and the firm hides its own the same way.
     * Every public query adds `idx_hidden = false` (`publicListing()`); only
     * the dashboard sees these rows. Derived, so it can never disagree with
     * the status.
     */
    idxHidden: boolean("idx_hidden")
      .notNull()
      .generatedAlwaysAs(
        (): SQL => sql`${listings.status} in ('coming_soon', 'withdrawn', 'expired', 'canceled')`,
      ),
    /**
     * When the listing first became publicly visible: on insert when it is,
     * else when a hidden row (Coming Soon) first turns visible. Saved-search
     * alerts call a home "new" by this, so a listing that spent its first days
     * as Coming Soon is still announced when it goes active.
     */
    publicSince: timestamp("public_since", { withTimezone: true }),
    /** Listed by our brokerage (manual source, or office ID matches). */
    isCompanyListing: boolean("is_company_listing").notNull().default(false),
    isFeatured: boolean("is_featured").notNull().default(false),

    /** RESO `ModificationTimestamp` — drives incremental sync. */
    sourceModifiedAt: timestamp("source_modified_at", { withTimezone: true }),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    /** Set when the listing leaves the feed. Hidden everywhere; saved homes show "no longer available". */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),

    searchVector: tsvector("search_vector").generatedAlwaysAs(
      (): SQL => sql`
        setweight(to_tsvector('english',
          coalesce(${listings.addressLine1}, '') || ' ' || coalesce(${listings.city}, '') || ' ' ||
          coalesce(${listings.postalCode}, '') || ' ' || coalesce(${listings.neighborhood}, '') || ' ' ||
          coalesce(${listings.mlsNumber}, '')), 'A') ||
        setweight(to_tsvector('english',
          coalesce(${listings.headline}, '') || ' ' || coalesce(${listings.propertySubType}, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(${listings.description}, '')), 'C')`,
    ),
    /**
     * Where the listing is, and nothing else. The location box (`q`) matches
     * this, never the description, so "Atlanta" finds homes in Atlanta rather
     * than every listing "minutes from Atlanta". 'simple' (no stemming): these
     * are names. It includes the lake (`water_body`), which real feeds keep
     * out of `neighborhood`. Keyword search over descriptions stays on `searchVector`.
     */
    locationVector: tsvector("location_vector").generatedAlwaysAs(
      (): SQL => sql`
        to_tsvector('simple',
          coalesce(${listings.addressLine1}, '') || ' ' || coalesce(${listings.city}, '') || ' ' ||
          coalesce(${listings.postalCode}, '') || ' ' || coalesce(${listings.neighborhood}, '') || ' ' ||
          coalesce(${listings.waterBodyName}, '') || ' ' || coalesce(${listings.mlsNumber}, ''))`,
    ),
  },
  (t) => [
    uniqueIndex("listings_source_key_idx").on(t.sourceId, t.listingKey),
    // No plain (status, …) index: every search mode's status filter is a
    // partial-index predicate below. A status index only tempted the planner
    // to AND a 50k–160k-row status bitmap into each location search (4 ms of
    // q=Lake Lanier's 6 ms page; `npm run perf:measure`).
    index("listings_city_idx").on(t.city),
    // text_pattern_ops also serves the autocomplete's ZIP prefix (LIKE '306%').
    index("listings_postal_code_idx").on(t.postalCode.op("text_pattern_ops")),
    index("listings_list_agent_idx").on(t.listAgentId),
    index("listings_updated_idx").on(t.updatedAt),
    index("listings_mls_number_idx").on(t.mlsNumber),
    index("listings_search_idx").using("gin", t.searchVector),
    index("listings_location_idx").using("gin", t.locationVector),
    // Trigram indexes (pg_trgm, see migrations): address autocomplete, and the
    // location box's and autocomplete's city/neighborhood prefix matches.
    index("listings_address_trgm_idx").using("gin", sql`${t.addressLine1} gin_trgm_ops`),
    index("listings_city_trgm_idx").using("gin", sql`${t.city} gin_trgm_ops`),
    index("listings_neighborhood_trgm_idx").using("gin", sql`${t.neighborhood} gin_trgm_ops`),
    // The same, for live listings only: autocomplete reads a few thousand
    // entries instead of every closed sale sharing the prefix.
    index("listings_live_city_trgm_idx")
      .using("gin", sql`${t.city} gin_trgm_ops`)
      .where(LIVE),
    index("listings_live_neighborhood_trgm_idx")
      .using("gin", sql`${t.neighborhood} gin_trgm_ops`)
      .where(LIVE),
    // The location box by scope: every search mode's WHERE implies LIVE (buy,
    // pending, rent) or SOLD, so each branch of its OR has an index over just
    // that scope. Without them the matches of every status are collected and
    // then ANDed with a status bitmap of 50k–160k rows: sold q=Atlanta counted
    // in 45 ms instead of 30 (`npm run perf:measure`).
    index("listings_live_location_idx").using("gin", t.locationVector).where(LIVE),
    index("listings_live_address_trgm_idx")
      .using("gin", sql`${t.addressLine1} gin_trgm_ops`)
      .where(LIVE),
    index("listings_sold_location_idx").using("gin", t.locationVector).where(SOLD),
    index("listings_sold_city_trgm_idx")
      .using("gin", sql`${t.city} gin_trgm_ops`)
      .where(SOLD),
    index("listings_sold_neighborhood_trgm_idx")
      .using("gin", sql`${t.neighborhood} gin_trgm_ops`)
      .where(SOLD),
    index("listings_sold_address_trgm_idx")
      .using("gin", sql`${t.addressLine1} gin_trgm_ops`)
      .where(SOLD),
    // Area-guide matching: the exact expression `normalizedSql` in
    // src/lib/areas/match.ts renders, so a guide name in the location box
    // ("Lake Hartwell") and the guide pages can use an index.
    index("listings_neighborhood_norm_idx").on(normalized(t.neighborhood)),
    index("listings_water_body_norm_idx").on(normalized(t.waterBodyName)),
    index("listings_city_norm_idx").on(normalized(t.city)),
    // The location box's guide-name branch, by scope like its other branches.
    index("listings_live_neighborhood_norm_idx").on(normalized(t.neighborhood)).where(LIVE),
    index("listings_live_water_body_norm_idx").on(normalized(t.waterBodyName)).where(LIVE),
    index("listings_sold_neighborhood_norm_idx").on(normalized(t.neighborhood)).where(SOLD),
    index("listings_sold_water_body_norm_idx").on(normalized(t.waterBodyName)).where(SOLD),

    // One partial index per result order, each matching `buildOrderBy` in
    // src/lib/search/query.ts exactly (the id tiebreak included), so a page
    // reads its rows off the index instead of sorting the whole feed. The
    // predicates are the modes' WHERE clauses. Numbers: `npm run perf:measure`.
    // Nulls placement must match too: Drizzle's `desc(col)` renders plain
    // DESC (NULLS FIRST), while drizzle-kit writes a bare `.desc()` as
    // DESC NULLS LAST, hence the explicit `.nullsFirst()`.
    index("listings_buy_recommended_idx")
      .on(
        t.isFeatured.desc().nullsFirst(),
        t.listDate.desc().nullsLast(),
        t.photoCount.desc().nullsFirst(),
        t.id,
      )
      .where(FOR_SALE),
    index("listings_buy_newest_idx").on(t.listDate.desc().nullsLast(), t.id).where(FOR_SALE),
    index("listings_buy_price_idx").on(t.listPrice, t.id).where(FOR_SALE),
    index("listings_buy_price_desc_idx").on(t.listPrice.desc().nullsFirst(), t.id).where(FOR_SALE),
    index("listings_buy_sqft_idx").on(t.livingAreaSqft.desc().nullsLast(), t.id).where(FOR_SALE),
    index("listings_buy_ppsf_idx")
      .on(sql`(${t.listPrice}::float / nullif(${t.livingAreaSqft}, 0)) asc nulls last`, t.id)
      .where(FOR_SALE),
    // Land sorts (site review #8): acreage, and price per acre.
    index("listings_buy_lot_idx").on(t.lotSizeSqft.desc().nullsLast(), t.id).where(FOR_SALE),
    index("listings_buy_ppa_idx")
      .on(sql`(${t.listPrice}::float / nullif(${t.lotSizeSqft}, 0)) asc nulls last`, t.id)
      .where(FOR_SALE),
    // Map bounds are `longitude/latitude BETWEEN`. The migration adds INCLUDE
    // (list_price, idx_hidden, property_type) so viewport counts stay
    // index-only, the default search's "no commercial" included.
    index("listings_buy_geo_idx").on(t.latitude, t.longitude).where(FOR_SALE),
    // `pending=1` (under contract and pending too): its 4-status IN doesn't
    // imply FOR_SALE, so it gets the same set.
    index("listings_live_recommended_idx")
      .on(
        t.isFeatured.desc().nullsFirst(),
        t.listDate.desc().nullsLast(),
        t.photoCount.desc().nullsFirst(),
        t.id,
      )
      .where(LIVE_SALE),
    index("listings_live_newest_idx").on(t.listDate.desc().nullsLast(), t.id).where(LIVE_SALE),
    index("listings_live_price_idx").on(t.listPrice, t.id).where(LIVE_SALE),
    index("listings_live_price_desc_idx")
      .on(t.listPrice.desc().nullsFirst(), t.id)
      .where(LIVE_SALE),
    index("listings_live_sqft_idx").on(t.livingAreaSqft.desc().nullsLast(), t.id).where(LIVE_SALE),
    index("listings_live_ppsf_idx")
      .on(sql`(${t.listPrice}::float / nullif(${t.livingAreaSqft}, 0)) asc nulls last`, t.id)
      .where(LIVE_SALE),
    index("listings_live_lot_idx").on(t.lotSizeSqft.desc().nullsLast(), t.id).where(LIVE_SALE),
    index("listings_live_ppa_idx")
      .on(sql`(${t.listPrice}::float / nullif(${t.lotSizeSqft}, 0)) asc nulls last`, t.id)
      .where(LIVE_SALE),
    // Rentals: few enough that one index serves every order and the count.
    index("listings_rent_recommended_idx")
      .on(
        t.isFeatured.desc().nullsFirst(),
        t.listDate.desc().nullsLast(),
        t.photoCount.desc().nullsFirst(),
        t.id,
      )
      .where(RENT),
    // Sold: about 150k closed sales a year statewide, inside the close-date
    // window, so every order gets its own index (a sort is ~260 ms without).
    index("listings_sold_recommended_idx")
      .on(
        t.isFeatured.desc().nullsFirst(),
        t.closeDate.desc().nullsLast(),
        t.photoCount.desc().nullsFirst(),
        t.id,
      )
      .where(SOLD),
    index("listings_sold_newest_idx").on(t.closeDate.desc().nullsLast(), t.id).where(SOLD),
    index("listings_sold_price_idx").on(t.listPrice, t.id).where(SOLD),
    index("listings_sold_price_desc_idx").on(t.listPrice.desc().nullsFirst(), t.id).where(SOLD),
    index("listings_sold_sqft_idx").on(t.livingAreaSqft.desc().nullsLast(), t.id).where(SOLD),
    index("listings_sold_ppsf_idx")
      .on(sql`(${t.listPrice}::float / nullif(${t.livingAreaSqft}, 0)) asc nulls last`, t.id)
      .where(SOLD),
    index("listings_sold_lot_idx").on(t.lotSizeSqft.desc().nullsLast(), t.id).where(SOLD),
    index("listings_sold_ppa_idx")
      .on(sql`(${t.listPrice}::float / nullif(${t.lotSizeSqft}, 0)) asc nulls last`, t.id)
      .where(SOLD),
    // Listing sitemap chunks (src/app/homes/sitemap.ts) page through live
    // listings by id. The migration adds INCLUDE (slug, updated_at) so a chunk
    // is an index-only scan.
    index("listings_live_id_idx").on(t.id).where(LIVE),
  ],
);

export const listingMedia = pgTable(
  "listing_media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    kind: mediaKind("kind").notNull().default("photo"),
    url: text("url").notNull(),
    caption: text("caption"),
    width: integer("width"),
    height: integer("height"),
    sortOrder: smallint("sort_order").notNull().default(0),
    /** RESO `MediaKey`, for idempotent sync. */
    sourceKey: text("source_key"),
  },
  (t) => [index("listing_media_listing_idx").on(t.listingId, t.sortOrder)],
);

export const openHouses = pgTable(
  "open_houses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    type: openHouseType("type").notNull().default("in_person"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    remarks: text("remarks"),
    sourceKey: text("source_key"),
  },
  (t) => [
    index("open_houses_listing_idx").on(t.listingId),
    index("open_houses_starts_idx").on(t.startsAt),
  ],
);

/** Price and status history, shown on the property page and used for alerts. */
export const listingEvents = pgTable(
  "listing_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    type: listingEventType("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    price: integer("price"),
    previousPrice: integer("previous_price"),
    fromStatus: listingStatus("from_status"),
    toStatus: listingStatus("to_status"),
  },
  (t) => [index("listing_events_listing_idx").on(t.listingId, t.occurredAt)],
);

export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    mode: syncMode("mode").notNull().default("incremental"),
    status: syncStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Written after every page. A `running` run whose heartbeat is older than
     * the function time limit was cut off; the next run marks it failed.
     */
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    fetched: integer("fetched").notNull().default(0),
    upserted: integer("upserted").notNull().default(0),
    /** Records whose ModificationTimestamp matched what we hold: nothing written. */
    unchanged: integer("unchanged").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    /** The source's cursor when the run ended (where a `partial` run stopped). */
    cursor: timestamp("cursor", { withTimezone: true }),
    error: text("error"),
  },
  (t) => [index("sync_runs_source_idx").on(t.sourceId, t.startedAt)],
);

/**
 * Listing office names by MLS office ID, from the feed's RESO Office resource
 * (src/lib/mls/office-lookup.ts), for listings whose feed sends no
 * ListOfficeName. `office_name` is null when the feed didn't know the ID.
 */
export const mlsOffices = pgTable("mls_offices", {
  officeMlsId: text("office_mls_id").primaryKey(),
  officeName: text("office_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Location autocomplete's place names (neighborhoods, cities, ZIPs) with live
 * listing counts. A materialized view created by hand in
 * drizzle/0006_sync_budget_and_places.sql (drizzle-kit ignores `.existing()`
 * views); `refreshPlaces()` (src/lib/listings/places.ts) rebuilds it after
 * every sync, seed and dashboard listing change.
 */
export const places = pgMaterializedView("places", {
  kind: text("kind").$type<"city" | "neighborhood" | "zip">().notNull(),
  label: text("label").notNull(),
  sublabel: text("sublabel").notNull(),
  n: integer("n").notNull(),
}).existing();
