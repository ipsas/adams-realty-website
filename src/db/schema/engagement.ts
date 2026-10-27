import {
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
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
    /**
     * When the lead first left "new" for contacted or qualified (a status change,
     * or a note saved with "Mark as contacted"). Never moves once set. Null for
     * leads not contacted yet, and for leads handled before it was recorded.
     */
    firstContactedAt: timestamp("first_contacted_at", { withTimezone: true }),
    /** "Follow up on" date, a calendar day in the market's time zone. */
    followUpOn: date("follow_up_on", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("inquiries_agent_status_idx").on(t.agentId, t.status),
    index("inquiries_follow_up_idx").on(t.followUpOn),
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
 * One row per morning summary (src/lib/leads/digest.ts) and market-calendar
 * day: `recipient` is `agent:<agent id>` or `office:<user id>`. Inserting the
 * row claims the day, so the sync and alerts crons that may run it never send twice;
 * a failed send deletes it again for the next run.
 */
export const leadDigests = pgTable(
  "lead_digests",
  {
    recipient: text("recipient").notNull(),
    day: date("day", { mode: "string" }).notNull(),
    /** Leads the summary listed (0: nothing needed attention, so no email went out). */
    items: integer("items").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.recipient, t.day] })],
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

/**
 * Emails sent through Resend per UTC day (`period` = 'YYYY-MM-DD', from the
 * database clock), for the batch-mail guard (src/lib/email-batch.ts): `batch`
 * counts search alerts, saved-home digests and morning summaries, `total`
 * every send (batch and transactional, per recipient). A logged table, unlike
 * `rate_limits`, so the counts survive a crash or a compute restart.
 */
export const emailSendCounters = pgTable("email_send_counters", {
  period: text("period").primaryKey(),
  batch: integer("batch").notNull().default(0),
  total: integer("total").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Durable one-time markers, e.g. `email_alerts_activated` (the first alerts
 * run with email configured marked older changes as seen: src/lib/email-batch.ts).
 */
export const appFlags = pgTable("app_flags", {
  key: text("key").primaryKey(),
  value: text("value"),
  setAt: timestamp("set_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Lead and assignment notices whose send still failed after the in-request
 * retries, tried again by the sync cron (src/lib/email-outbox.ts). References
 * only, never a body, subject, address, name, phone, token or link: the email
 * is rebuilt from the current lead and recipient when it is sent. `entity_id`
 * is the lead; the recipient is `recipient_role` ('agent': an agents.id,
 * 'admin': a users.id, 'office' and 'corrections': no id). One row per notice
 * and recipient. A logged table, so a queued notice survives a restart.
 */
export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<"lead-notice" | "lead-copy" | "lead-assignment">().notNull(),
    entityId: uuid("entity_id").notNull(),
    recipientRole: text("recipient_role")
      .$type<"agent" | "admin" | "office" | "corrections">()
      .notNull(),
    recipientId: text("recipient_id"),
    /** Tries so far, the in-request one included. */
    attempts: integer("attempts").notNull().default(1),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    /** The last failure, e.g. 'http_503', 'http_429', 'network'. */
    lastStatus: text("last_status"),
    state: text("state").$type<"pending" | "dead">().notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("email_outbox_notice_key")
      .on(t.kind, t.entityId, t.recipientRole, t.recipientId)
      .nullsNotDistinct(),
    index("email_outbox_due_idx").on(t.state, t.nextAttemptAt),
  ],
);
