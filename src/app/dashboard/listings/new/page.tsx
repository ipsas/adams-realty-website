import { ListingForm } from "@/components/dashboard/listing-form";
import { PageHeader } from "@/components/dashboard/ui";
import { site } from "@/config/site";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { getAgentOptions } from "@/lib/dashboard/queries";

export const metadata = { title: "New listing" };

export default async function NewListingPage() {
  const actor = await requirePermission("/dashboard/listings/new", can.createListing);
  const agents = await getAgentOptions();
  return (
    <>
      <PageHeader
        title="New listing"
        description="For pocket listings, coming-soon marketing and rentals. Listings already in the MLS appear automatically. Open houses can be scheduled once the listing is created."
      />
      <ListingForm
        values={{
          status: "coming_soon",
          transactionType: "sale",
          propertyType: "single_family",
          state: site.market.state,
          listAgentId: actor.agentId,
        }}
        agents={agents}
        canFeature={can.featureListing(actor)}
        canAssignAgent={actor.role === "admin"}
        canDelete={false}
      />
    </>
  );
}
