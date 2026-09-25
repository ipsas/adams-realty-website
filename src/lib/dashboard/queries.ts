import { and, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  agents,
  dataSources,
  inquiries,
  listings,
  savedListings,
  syncRuns,
  users,
} from "@/db/schema";
import { can, type Actor } from "@/lib/auth/permissions";

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
        thisWeek: sql<number>`count(*) filter (where ${inquiries.createdAt} >= ${weekAgo})::int`,
        tours: sql<number>`count(*) filter (where ${inquiries.type} = 'tour' and ${inquiries.tourAt} >= now())::int`,
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
      leads: sql<number>`(select count(*)::int from inquiries i where i.listing_id = "listings"."id")`,
    })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .leftJoin(agents, eq(listings.listAgentId, agents.id))
    .where(and(isNull(listings.removedAt), listingScope(actor)))
    .orderBy(desc(listings.updatedAt))
    .limit(500);
}

export async function getLeads(actor: Actor, opts: { status?: string; limit?: number } = {}) {
  const statusFilter =
    opts.status && ["new", "contacted", "qualified", "closed", "spam"].includes(opts.status)
      ? eq(inquiries.status, opts.status as "new")
      : inArray(inquiries.status, ["new", "contacted", "qualified"]);
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
    })
    .from(inquiries)
    .leftJoin(agents, eq(inquiries.agentId, agents.id))
    .leftJoin(listings, eq(inquiries.listingId, listings.id))
    .where(and(statusFilter, leadScope(actor)))
    .orderBy(desc(inquiries.createdAt))
    .limit(opts.limit ?? 200);
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
  return sources.map((s) => ({
    ...s,
    listingCount: counts.find((c) => c.sourceId === s.id)?.count ?? 0,
    runs: runs.filter((r) => r.sourceId === s.id).slice(0, 5),
  }));
}
