import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { SearchCriteria } from "@/lib/search/params";
import { users } from "./auth";
import { alertFrequency, inquiryStatus, inquiryType, tourType } from "./enums";
import { listings } from "./listings";
import { agents } from "./people";

export const savedListings = pgTable(
  "saved_listings",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Last time this user was emailed about a change (price, status) to this home. */
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.listingId] }),
    index("saved_listings_listing_idx").on(t.listingId),
  ],
);

/**
 * `criteria` stores the same object the search page parses from its URL, so a
 * saved search always reproduces exactly what the user saw.
 */
export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    criteria: jsonb("criteria").$type<SearchCriteria>().notNull(),
    alertFrequency: alertFrequency("alert_frequency").notNull().default("daily"),
    lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("saved_searches_user_idx").on(t.userId)],
);

/** Leads: questions, tour requests, valuation requests. */
export const inquiries = pgTable(
  "inquiries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: inquiryType("type").notNull(),
    status: inquiryStatus("status").notNull().default("new"),
    listingId: uuid("listing_id").references(() => listings.id, { onDelete: "set null" }),
    /** Assigned agent. Defaults to the listing agent, else routed by an admin. */
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    message: text("message"),
    tourAt: timestamp("tour_at", { withTimezone: true }),
    tourType: tourType("tour_type"),
    /** Page the lead came from, e.g. "listing", "sell", "agent", "contact". */
    source: text("source").notNull(),
    metadata: jsonb("metadata").$type<Record<string, string>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("inquiries_agent_status_idx").on(t.agentId, t.status),
    index("inquiries_created_idx").on(t.createdAt),
    index("inquiries_listing_idx").on(t.listingId),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_entity_idx").on(t.entityType, t.entityId)],
);

/** Private notes staff keep on a lead (calls, showings, next steps). */
export const leadNotes = pgTable(
  "lead_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inquiryId: uuid("inquiry_id")
      .notNull()
      .references(() => inquiries.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_notes_inquiry_idx").on(t.inquiryId, t.createdAt)],
);

/**
 * Listing page views per day, so traffic statistics can be shared with Georgia
 * MLS (IDX agreement, Exhibit A §9). One row per listing and market-calendar
 * day, incremented by `recordListingView` (src/lib/listings/views.ts) when a
 * listing page is shown; admins export it as CSV from /dashboard/traffic.
 */
export const listingViews = pgTable(
  "listing_views",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    views: integer("views").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.day] }), index("listing_views_day_idx").on(t.day)],
);

/**
 * Fixed-window request counters for the anti-scraping limiter
 * (src/lib/rate-limit-db.ts). Shared by every serverless instance, unlike an
 * in-memory map. `key` is bucket + window length + client IP; rows whose
 * window ended long ago are pruned by `pruneRateLimits`.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});
