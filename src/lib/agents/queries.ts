import { and, asc, eq, sql } from "drizzle-orm";
import { cache } from "react";
import { db } from "@/db";
import { agents, listings } from "@/db/schema";
import { publicListing } from "@/lib/listings/visibility";

export async function getAgents() {
  return db
    .select({
      id: agents.id,
      slug: agents.slug,
      name: agents.name,
      title: agents.title,
      phone: agents.phone,
      email: agents.email,
      photoUrl: agents.photoUrl,
      specialties: agents.specialties,
      serviceAreas: agents.serviceAreas,
      languages: agents.languages,
      yearsExperience: agents.yearsExperience,
      activeListings: sql<number>`(
        select count(*)::int from ${listings}
        where ${listings.listAgentId} = "agents"."id" and ${listings.removedAt} is null and not ${listings.idxHidden}
          and ${listings.status} in ('active', 'coming_soon')
      )`,
    })
    .from(agents)
    .where(eq(agents.isActive, true))
    .orderBy(asc(agents.sortOrder), asc(agents.name));
}

export const getAgentBySlug = cache(async (slug: string) => {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.slug, slug), eq(agents.isActive, true)))
    .limit(1);
  if (!agent) return null;
  const [stats] = await db
    .select({
      active: sql<number>`count(*) filter (where ${listings.status} in ('active','coming_soon'))::int`,
      sold: sql<number>`count(*) filter (where ${listings.status} = 'closed')::int`,
    })
    .from(listings)
    .where(and(eq(listings.listAgentId, agent.id), publicListing()));
  return { agent, stats };
});
