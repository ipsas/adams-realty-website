import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { forbidden, notFound } from "next/navigation";
import { z } from "zod";
import { ListingForm } from "@/components/dashboard/listing-form";
import { PageHeader } from "@/components/dashboard/ui";
import { FormMessage } from "@/components/ui/form";
import { db } from "@/db";
import { dataSources, listingMedia, listings } from "@/db/schema";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getAgentOptions } from "@/lib/dashboard/queries";

export const metadata = { title: "Edit listing" };

export default async function EditListingPage(props: PageProps<"/dashboard/listings/[id]">) {
  const { id } = await props.params;
  const { created } = await props.searchParams;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const actor = await requirePermission(`/dashboard/listings/${id}`, can.viewDashboard);

  const [row] = await db
    .select({ listing: listings, kind: dataSources.kind })
    .from(listings)
    .innerJoin(dataSources, eq(listings.sourceId, dataSources.id))
    .where(eq(listings.id, id))
    .limit(1);
  if (!row) notFound();
  const l = row.listing;
  const subject = { sourceKind: row.kind, listAgentId: l.listAgentId };
  if (!can.editListing(actor, subject)) forbidden();

  const [media, agents] = await Promise.all([
    db
      .select({ url: listingMedia.url })
      .from(listingMedia)
      .where(eq(listingMedia.listingId, id))
      .orderBy(asc(listingMedia.sortOrder)),
    getAgentOptions(),
  ]);

  return (
    <>
      <PageHeader
        title={l.addressLine1}
        description={
          <>
            {l.city}, {l.state} {l.postalCode} ·{" "}
            <Link href={`/homes/${l.slug}`} className="font-medium text-brand-700 hover:underline">
              View public page
            </Link>
          </>
        }
      />
      {created && (
        <div className="mb-6">
          <FormMessage tone="success">
            Listing created. It&apos;s live on the site now if its status is Active or Coming soon.
          </FormMessage>
        </div>
      )}
      <ListingForm
        values={{ ...l, photos: media.map((m) => m.url) }}
        agents={agents}
        canFeature={can.featureListing(actor)}
        canAssignAgent={actor.role === "admin"}
        canDelete={can.deleteListing(actor, subject)}
      />
    </>
  );
}
