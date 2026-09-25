import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Roles are deliberately coarse. Fine-grained rules (e.g. "an agent may edit
 * only their own manual listings") live in `src/lib/auth/permissions.ts`.
 */
export const userRole = pgEnum("user_role", ["user", "agent", "admin"]);

/**
 * Normalized from RESO `StandardStatus`. See `src/lib/mls/reso/mapper.ts`
 * for the mapping from feed values.
 */
export const listingStatus = pgEnum("listing_status", [
  "coming_soon",
  "active",
  "active_under_contract",
  "pending",
  "closed",
  "withdrawn",
  "expired",
  "canceled",
]);

export const transactionType = pgEnum("transaction_type", ["sale", "rent"]);

/** Normalized from RESO `PropertyType` + `PropertySubType`. */
export const propertyType = pgEnum("property_type", [
  "single_family",
  "condo",
  "townhouse",
  "multi_family",
  "manufactured",
  "land",
  "farm_ranch",
  "commercial",
  "other",
]);

export const listingEventType = pgEnum("listing_event_type", [
  "listed",
  "price_change",
  "status_change",
  "sold",
  "relisted",
  "removed",
]);

export const mediaKind = pgEnum("media_kind", ["photo", "floor_plan", "video", "virtual_tour"]);

export const openHouseType = pgEnum("open_house_type", ["in_person", "virtual"]);

export const dataSourceKind = pgEnum("data_source_kind", ["manual", "reso_web_api"]);

export const syncStatus = pgEnum("sync_status", ["running", "succeeded", "failed"]);

export const inquiryType = pgEnum("inquiry_type", [
  "question",
  "tour",
  "offer",
  "valuation",
  "general",
]);

export const inquiryStatus = pgEnum("inquiry_status", [
  "new",
  "contacted",
  "qualified",
  "closed",
  "spam",
]);

export const tourType = pgEnum("tour_type", ["in_person", "video"]);

export const alertFrequency = pgEnum("alert_frequency", ["instant", "daily", "weekly", "off"]);
