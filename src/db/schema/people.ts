import { boolean, index, pgTable, smallint, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const offices = pgTable("offices", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  addressLine1: text("address_line1"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  /** The office's ID in the MLS, used to flag our own listings in the feed. */
  mlsOfficeId: text("mls_office_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Public agent profile. Linked to a login (`userId`) when the agent has an
 * account; an agent can exist without one (e.g. before onboarding).
 */
export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .unique()
      .references(() => users.id, { onDelete: "set null" }),
    officeId: uuid("office_id").references(() => offices.id, { onDelete: "set null" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    title: text("title"),
    email: text("email").notNull(),
    phone: text("phone"),
    bio: text("bio"),
    photoUrl: text("photo_url"),
    licenseNumber: text("license_number"),
    /** The agent's ID in the MLS, used to link feed listings to this profile. */
    mlsAgentId: text("mls_agent_id"),
    specialties: text("specialties").array().notNull().default([]),
    languages: text("languages").array().notNull().default([]),
    serviceAreas: text("service_areas").array().notNull().default([]),
    yearsExperience: smallint("years_experience"),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("agents_mls_agent_idx").on(t.mlsAgentId)],
);
