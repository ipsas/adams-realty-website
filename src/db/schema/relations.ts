import { relations } from "drizzle-orm";
import { users } from "./auth";
import { auditLogs, inquiries, leadNotes, savedListings, savedSearches } from "./engagement";
import {
  dataSources,
  listingEvents,
  listingMedia,
  listings,
  openHouses,
  syncRuns,
} from "./listings";
import { agents, offices } from "./people";

export const usersRelations = relations(users, ({ one, many }) => ({
  agent: one(agents, { fields: [users.id], references: [agents.userId] }),
  savedListings: many(savedListings),
  savedSearches: many(savedSearches),
}));

export const officesRelations = relations(offices, ({ many }) => ({
  agents: many(agents),
}));

export const agentsRelations = relations(agents, ({ one, many }) => ({
  user: one(users, { fields: [agents.userId], references: [users.id] }),
  office: one(offices, { fields: [agents.officeId], references: [offices.id] }),
  listings: many(listings),
  inquiries: many(inquiries),
}));

export const dataSourcesRelations = relations(dataSources, ({ many }) => ({
  listings: many(listings),
  syncRuns: many(syncRuns),
}));

export const listingsRelations = relations(listings, ({ one, many }) => ({
  source: one(dataSources, { fields: [listings.sourceId], references: [dataSources.id] }),
  listAgent: one(agents, { fields: [listings.listAgentId], references: [agents.id] }),
  media: many(listingMedia),
  openHouses: many(openHouses),
  events: many(listingEvents),
  savedBy: many(savedListings),
}));

export const listingMediaRelations = relations(listingMedia, ({ one }) => ({
  listing: one(listings, { fields: [listingMedia.listingId], references: [listings.id] }),
}));

export const openHousesRelations = relations(openHouses, ({ one }) => ({
  listing: one(listings, { fields: [openHouses.listingId], references: [listings.id] }),
}));

export const listingEventsRelations = relations(listingEvents, ({ one }) => ({
  listing: one(listings, { fields: [listingEvents.listingId], references: [listings.id] }),
}));

export const syncRunsRelations = relations(syncRuns, ({ one }) => ({
  source: one(dataSources, { fields: [syncRuns.sourceId], references: [dataSources.id] }),
}));

export const savedListingsRelations = relations(savedListings, ({ one }) => ({
  user: one(users, { fields: [savedListings.userId], references: [users.id] }),
  listing: one(listings, { fields: [savedListings.listingId], references: [listings.id] }),
}));

export const savedSearchesRelations = relations(savedSearches, ({ one }) => ({
  user: one(users, { fields: [savedSearches.userId], references: [users.id] }),
}));

export const leadNotesRelations = relations(leadNotes, ({ one }) => ({
  inquiry: one(inquiries, { fields: [leadNotes.inquiryId], references: [inquiries.id] }),
  author: one(users, { fields: [leadNotes.authorId], references: [users.id] }),
}));

export const inquiriesRelations = relations(inquiries, ({ one, many }) => ({
  notes: many(leadNotes),
  listing: one(listings, { fields: [inquiries.listingId], references: [listings.id] }),
  agent: one(agents, { fields: [inquiries.agentId], references: [agents.id] }),
  user: one(users, { fields: [inquiries.userId], references: [users.id] }),
}));

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  actor: one(users, { fields: [auditLogs.actorId], references: [users.id] }),
}));
