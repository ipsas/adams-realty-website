import { sql, type SQL } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
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
  syncStatus,
  transactionType,
} from "./enums";
import { agents } from "./people";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

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
  /** Env var prefix holding credentials: `${prefix}_TOKEN` or `${prefix}_CLIENT_ID`/`_CLIENT_SECRET`. */
  credentialsEnvPrefix?: string;
  /** OAuth2 token URL when the feed uses client-credentials auth. */
  tokenUrl?: string;
  /** MLS office IDs that belong to our brokerage; their listings get `isCompanyListing`. */
  companyOfficeIds?: string[];
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
  },
  (t) => [
    uniqueIndex("listings_source_key_idx").on(t.sourceId, t.listingKey),
    index("listings_status_price_idx").on(t.status, t.listPrice),
    index("listings_city_idx").on(t.city),
    index("listings_postal_code_idx").on(t.postalCode),
    index("listings_list_agent_idx").on(t.listAgentId),
    index("listings_updated_idx").on(t.updatedAt),
    // Bounding-box map search with built-in geometric types (no PostGIS needed):
    //   point(longitude, latitude) <@ box(point(w, s), point(e, n))
    index("listings_geo_idx").using("gist", sql`point(${t.longitude}, ${t.latitude})`),
    index("listings_search_idx").using("gin", t.searchVector),
    // Trigram index for address autocomplete (requires pg_trgm, see migrations).
    index("listings_address_trgm_idx").using("gin", sql`${t.addressLine1} gin_trgm_ops`),
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
    status: syncStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    fetched: integer("fetched").notNull().default(0),
    upserted: integer("upserted").notNull().default(0),
    removed: integer("removed").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("sync_runs_source_idx").on(t.sourceId, t.startedAt)],
);
