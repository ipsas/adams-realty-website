/**
 * IDX (Georgia MLS agreement, Exhibit C): every listing display names the
 * listing office. The firm's own listings (isCompanyListing: its MLS office
 * IDs; and every manual dashboard listing, `fromFeed: false`, even a row saved
 * before it got isCompanyListing) always show its legal name, above
 * any feed, looked-up or stored name. Others: the feed's ListOfficeName
 * (gamls2 sends it empty), then the name the sync looked up in the feed's
 * Office resource (`officeLookupName`, src/lib/mls/office-lookup.ts), else
 * "MLS Office ID <id>". Null only when there is no office at all, so
 * "Not provided" never stands in for a known office.
 *
 * Fields are optional so cards cached before they were added still render.
 */
export type ListingOfficeFields = {
  listOfficeName?: string | null;
  officeLookupName?: string | null;
  listOfficeMlsId?: string | null;
  isCompanyListing?: boolean | null;
  /** Only an explicit false (a manual listing) counts: a card cached without it stays as it was. */
  fromFeed?: boolean | null;
};

export function listingOfficeLabel(
  l: ListingOfficeFields,
  firm: { legalName: string },
): string | null {
  if (l.isCompanyListing || l.fromFeed === false) return firm.legalName;
  const feedName = l.listOfficeName?.trim();
  if (feedName) return feedName;
  const lookupName = l.officeLookupName?.trim();
  if (lookupName) return lookupName;
  const id = l.listOfficeMlsId?.trim();
  return id ? `MLS Office ID ${id}` : null;
}
