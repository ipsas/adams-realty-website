import { and, desc, eq, gte, inArray, isNull, ne, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  dataSources,
  inquiries,
  leadNotes,
  listings,
  savedListings,
  syncRuns,
  users,
} from "@/db/schema";
import { can, type Actor } from "@/lib/auth/permissions";

export const LEAD_STATUSES = ["new", "contacted", "qualified", "closed", "spam"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const isLeadStatus = (v: unknown): v is LeadStatus =>
  typeof v === "string" && (LEAD_STATUSES as readonly string[]).includes(v);

/**
 * A `?status=` value → SQL filter: one status, `all`, or (anything else) the
 * open statuses the Leads page shows by default.
 */
function leadStatusFilter(status: string | undefined): SQL | undefined {
  if (status === "all") return undefined;
  if (isLeadStatus(status)) return eq(inquiries.status, status);
  return inArray(inquiries.status, ["new", "contacted", "qualified"]);
}

// Correlated subqueries on a lead's notes (explicit table name — see CLAUDE.md).
const notesCount = sql<number>`(select count(*)::int from lead_notes n where n.inquiry_id = "inquiries"."id")`;
const latestNote = sql<
  string | null
>`(select n.body from lead_notes n where n.inquiry_id = "inquiries"."id" order by n.created_at desc, n.id desc limit 1)`;

/** Listings the actor manages: admins see all company listings, agents their own. */
function listingScope(actor: Actor): SQL | undefined {
  if (can.viewAllListingsInDashboard(actor)) return eq(listings.isCompanyListing, true);
  return actor.agentId ? eq(listings.listAgentId, actor.agentId) : sql`false`;
}

/** Leads the actor may see: admins all, agents only those assigned to them. */
function leadScope(actor: Actor): SQL | undefined {
  if (can.viewAllInquiries(actor)) return undefined;
  return actor.agentId ? eq(inquiries.agentId, actor.agentId) : sql`false`;
}

export async function getOverview(actor: Actor) {
  const weekAgo = new Date(Date.now() - 7 * 86_400_000);
  const [[listingStats], [leadStats], [saves], recentLeads] = await Promise.all([
    db
      .select({
        active: sql<number>`count(*) filter (where ${listings.status} in ('active','coming_soon'))::int`,
        pending: sql<number>`count(*) filter (where ${listings.status} in ('active_under_contract','pending'))::int`,
        volume: sql<number>`coalesce(sum(${listings.listPrice}) filter (where ${listings.status} in ('active','coming_soon') and ${listings.transactionType} = 'sale'), 0)::bigint`,
      })
      .from(listings)
      .where(and(isNull(listings.removedAt), listingScope(actor))),
    db
      .select({
        newLeads: sql<number>`count(*) filter (where ${inquiries.status} = 'new')::int`,
        // Suspected spam (src/lib/spam.ts) is no lead: it waits in the Spam tab.
        thisWeek: sql<number>`count(*) filter (where ${inquiries.createdAt} >= ${weekAgo} and ${inquiries.status} <> 'spam')::int`,
        tours: sql<number>`count(*) filter (where ${inquiries.type} = 'tour' and ${inquiries.tourAt} >= now() and ${inquiries.status} <> 'spam')::int`,
      })
      .from(inquiries)
      .where(leadScope(actor)),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(savedListings)
      .innerJoin(listings, eq(savedListings.listingId, listings.id))
      .where(
        and(
          listingScope(actor),
          gte(savedListings.createdAt, new Date(Date.now() - 30 * 86_400_000)),
        ),
      ),
    getLeads(actor, { limit: 6 }),
  ]);
  return { listingStats, leadStats, saves: saves.count, recentLeads };
}

export async function getDashboardListings(actor: Actor) {
  return db
    .select({
      id: listings.id,
      slug: listings.slug,
      addressLine1: listings.addressLine1,
      unitNumber: listings.unitNumber,
      city: listings.city,
      status: listings.status,
      transactionType: listings.transactionType,
      listPrice: listings.listPrice,
      primaryPhotoUrl: listings.primaryPhotoUrl,
      isFeatured: listings.isFeatured,
      updatedAt: listings.updatedAt,
      agentName: agents.name,
      sourceKind: dataSources.kind,
      listAgentId: listings.listAgentId,
      saves: sql<number>`(select count(*)::int from saved_listings s where s.listing_id = "listings"."id")`,
      leads: sql<number>`(select count(*)::int from inquiries i where i.listing_id = "listings"."id" and i.status <> 'spam')`,
    })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .leftJoin(agents, eq(listings.listAgentId, agents.id))
    .where(and(isNull(listings.removedAt), listingScope(actor)))
    .orderBy(desc(listings.updatedAt))
    .limit(500);
}

/** `status`: a lead status, `all`, or omitted for the open ones (new, contacted, qualified). */
export async function getLeads(actor: Actor, opts: { status?: string; limit?: number } = {}) {
  return db
    .select({
      id: inquiries.id,
      type: inquiries.type,
      status: inquiries.status,
      name: inquiries.name,
      email: inquiries.email,
      phone: inquiries.phone,
      message: inquiries.message,
      tourAt: inquiries.tourAt,
      tourType: inquiries.tourType,
      createdAt: inquiries.createdAt,
      agentId: inquiries.agentId,
      agentName: agents.name,
      listingSlug: listings.slug,
      listingAddress: listings.addressLine1,
      notesCount,
      /** Why the spam check flagged it (src/lib/spam.ts), comma-separated; null if it didn't. */
      spamReasons: sql<string | null>`"inquiries"."metadata"->>'spam'`,
    })
    .from(inquiries)
    .leftJoin(agents, eq(inquiries.agentId, agents.id))
    .leftJoin(listings, eq(inquiries.listingId, listings.id))
    .where(and(leadStatusFilter(opts.status), leadScope(actor)))
    .orderBy(desc(inquiries.createdAt))
    .limit(opts.limit ?? 200);
}

/** Leads in the Spam tab the actor may see, for its label. */
export async function getSpamCount(actor: Actor): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(inquiries)
    .where(and(eq(inquiries.status, "spam"), leadScope(actor)));
  return row?.count ?? 0;
}

/**
 * One lead with its assigned agent and the home it's about (null when it isn't
 * about a listing, e.g. a valuation). Callers authorize with `can.viewInquiry`.
 */
export async function getLead(id: string) {
  const [row] = await db
    .select({
      lead: inquiries,
      agentName: agents.name,
      listing: {
        id: listings.id,
        slug: listings.slug,
        addressLine1: listings.addressLine1,
        unitNumber: listings.unitNumber,
        city: listings.city,
        state: listings.state,
        postalCode: listings.postalCode,
        hideAddress: listings.hideAddress,
        status: listings.status,
        transactionType: listings.transactionType,
        listPrice: listings.listPrice,
        primaryPhotoUrl: listings.primaryPhotoUrl,
        bedrooms: listings.bedrooms,
        bathrooms: listings.bathrooms,
        livingAreaSqft: listings.livingAreaSqft,
        listAgentId: listings.listAgentId,
        removedAt: listings.removedAt,
      },
      // Kept outside `listing`: Drizzle only nulls a nested object whose fields share one table.
      sourceKind: dataSources.kind,
    })
    .from(inquiries)
    .leftJoin(agents, eq(inquiries.agentId, agents.id))
    .leftJoin(listings, eq(inquiries.listingId, listings.id))
    .leftJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .where(eq(inquiries.id, id))
    .limit(1);
  if (!row) return null;
  const { lead, agentName, listing, sourceKind } = row;
  return {
    ...lead,
    agentName,
    listing: listing && sourceKind ? { ...listing, sourceKind } : null,
  };
}

/** A lead's notes, newest first, with each author's name (null if their account is gone). */
export async function getLeadNotes(inquiryId: string) {
  return db
    .select({
      id: leadNotes.id,
      body: leadNotes.body,
      createdAt: leadNotes.createdAt,
      authorId: leadNotes.authorId,
      authorName: users.name,
    })
    .from(leadNotes)
    .leftJoin(users, eq(leadNotes.authorId, users.id))
    .where(eq(leadNotes.inquiryId, inquiryId))
    .orderBy(desc(leadNotes.createdAt), desc(leadNotes.id));
}

/** Other leads from the same email address (case-insensitive) that the actor may see. */
export async function getContactActivity(actor: Actor, email: string, excludeId: string) {
  return db
    .select({
      id: inquiries.id,
      type: inquiries.type,
      status: inquiries.status,
      createdAt: inquiries.createdAt,
      tourAt: inquiries.tourAt,
      agentName: agents.name,
      listingAddress: listings.addressLine1,
      listingCity: listings.city,
    })
    .from(inquiries)
    .leftJoin(agents, eq(inquiries.agentId, agents.id))
    .leftJoin(listings, eq(inquiries.listingId, listings.id))
    .where(
      and(
        sql`lower(${inquiries.email}) = lower(${email})`,
        ne(inquiries.id, excludeId),
        leadScope(actor),
      ),
    )
    .orderBy(desc(inquiries.createdAt))
    .limit(20);
}

/** Position in the export's newest-first order. `createdAt` is Postgres text, keeping microseconds. */
export type LeadExportCursor = { createdAt: string; id: string };

/**
 * One page of leads for the CSV export, newest first. Keyset pagination lets
 * the route stream any number of rows without holding them all in memory.
 */
export async function getLeadExportPage(
  actor: Actor,
  opts: { status?: string; after?: LeadExportCursor | null; limit: number },
) {
  const after = opts.after
    ? sql`("inquiries"."created_at", "inquiries"."id") < (${opts.after.createdAt}::timestamptz, ${opts.after.id}::uuid)`
    : undefined;
  return db
    .select({
      id: inquiries.id,
      cursor: sql<string>`"inquiries"."created_at"::text`,
      createdAt: inquiries.createdAt,
      status: inquiries.status,
      type: inquiries.type,
      name: inquiries.name,
      email: inquiries.email,
      phone: inquiries.phone,
      message: inquiries.message,
      tourAt: inquiries.tourAt,
      tourType: inquiries.tourType,
      source: inquiries.source,
      agentName: agents.name,
      listingSlug: listings.slug,
      listingAddressLine1: listings.addressLine1,
      listingUnitNumber: listings.unitNumber,
      listingCity: listings.city,
      listingState: listings.state,
      listingPostalCode: listings.postalCode,
      notesCount,
      latestNote,
    })
    .from(inquiries)
    .leftJoin(agents, eq(inquiries.agentId, agents.id))
    .leftJoin(listings, eq(inquiries.listingId, listings.id))
    .where(and(leadStatusFilter(opts.status), leadScope(actor), after))
    .orderBy(desc(inquiries.createdAt), desc(inquiries.id))
    .limit(opts.limit);
}

export async function getAgentOptions() {
  return db
    .select({ id: agents.id, name: agents.name, userId: agents.userId })
    .from(agents)
    .where(eq(agents.isActive, true))
    .orderBy(agents.name);
}

export async function getUsers() {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      createdAt: users.createdAt,
      agentId: agents.id,
    })
    .from(users)
    .leftJoin(agents, eq(agents.userId, users.id))
    .orderBy(
      sql`case ${users.role} when 'admin' then 0 when 'agent' then 1 else 2 end`,
      desc(users.createdAt),
    )
    .limit(500);
}

export async function getSources() {
  const sources = await db.select().from(dataSources).orderBy(dataSources.createdAt);
  const counts = await db
    .select({ sourceId: listings.sourceId, count: sql<number>`count(*)::int` })
    .from(listings)
    .where(isNull(listings.removedAt))
    .groupBy(listings.sourceId);
  const runs = await db.select().from(syncRuns).orderBy(desc(syncRuns.startedAt)).limit(20);
  const history = await db
    .select({
      sourceId: syncRuns.sourceId,
      firstRunAt: sql<Date | null>`min(${syncRuns.startedAt})`.mapWith(syncRuns.startedAt),
      lastPurgeAt:
        sql<Date | null>`max(${syncRuns.finishedAt}) filter (where ${syncRuns.mode} = 'purge' and ${syncRuns.status} = 'succeeded')`.mapWith(
          syncRuns.finishedAt,
        ),
    })
    .from(syncRuns)
    .groupBy(syncRuns.sourceId);
  return sources.map((s) => {
    const h = history.find((x) => x.sourceId === s.id);
    return {
      ...s,
      listingCount: counts.find((c) => c.sourceId === s.id)?.count ?? 0,
      runs: runs.filter((r) => r.sourceId === s.id).slice(0, 5),
      firstRunAt: h?.firstRunAt ?? null,
      lastPurgeAt: h?.lastPurgeAt ?? null,
    };
  });
}
