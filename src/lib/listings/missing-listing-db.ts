import { eq } from "drizzle-orm";
import type { Db } from "@/db";
import { dataSources, listings } from "@/db/schema";
import { guideSlugForMissingListing } from "./missing-listing";
import { canShowDetails } from "./visibility";

/**
 * The proxy's one lookup for a listing page (see ./missing-listing.ts): null
 * when the page will show the listing (the same join and rule as
 * getListingBySlug), else the slug of its town's guide, or undefined when
 * there is none.
 */
export async function missingListingGuide(
  database: Db,
  slug: string,
): Promise<string | null | undefined> {
  const [row] = await database
    .select({
      city: listings.city,
      state: listings.state,
      status: listings.status,
      fromFeed: listings.fromFeed,
      removedAt: listings.removedAt,
    })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .where(eq(listings.slug, slug))
    .limit(1);
  if (row && canShowDetails(row)) return null;
  return guideSlugForMissingListing(slug, row);
}
