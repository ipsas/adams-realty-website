import Link from "next/link";
import NotFound from "@/app/not-found";
import { areaHref } from "@/config/areas";
import { guideForListingSlug, missingListing } from "@/lib/listings/missing-listing";
import { getListingPlaceBySlug } from "@/lib/listings/queries";

export { metadata } from "@/app/not-found";

/** The site's 404, plus a link to the missing listing's town guide when we publish one. */
export default async function ListingNotFound() {
  const slug = await missingListing().slug;
  const guide = slug ? guideForListingSlug(slug, await getListingPlaceBySlug(slug)) : undefined;
  return (
    <NotFound>
      {guide && (
        <Link href={areaHref(guide)} className="mt-6 font-medium text-brand-700 hover:underline">
          See homes for sale in {guide.name}
        </Link>
      )}
    </NotFound>
  );
}
