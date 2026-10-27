/**
 * IDX (Georgia MLS agreement, Exhibit C): every listing display names the
 * listing office. The feed's ListOfficeName first; gamls2 sends it empty, so
 * then the firm's legal name for its own listings, then the name the sync
 * looked up in the feed's Office resource (`officeLookupName`,
 * src/lib/mls/office-lookup.ts), else "MLS Office ID <id>". Null only when
 * there is no office at all, so "Not provided" never stands in for a known office.
 *
 * Fields are optional so cards cached before they were added still render.
 */
export type ListingOfficeFields = {
  listOfficeName?: string | null;
  officeLookupName?: string | null;
  listOfficeMlsId?: string | null;
  isCompanyListing?: boolean | null;
};

export function listingOfficeLabel(
  l: ListingOfficeFields,
  firm: { legalName: string },
): string | null {
  const feedName = l.listOfficeName?.trim();
  if (feedName) return feedName;
  if (l.isCompanyListing) return firm.legalName;
  const lookupName = l.officeLookupName?.trim();
  if (lookupName) return lookupName;
  const id = l.listOfficeMlsId?.trim();
  return id ? `MLS Office ID ${id}` : null;
}
