## Georgia MLS license compliance (from the IDX/Vendor Data License Agreement, v. Aug 1 2023, Exhibits A–C)

Required before real feed data goes public. This belongs to GA-A, or to its own small step after it.

- **No public display of Coming Soon, Expired, On Hold or Withdrawn listings** from the feed (Exhibit A §17). The owner decided to hide the firm's own manually entered listings in these statuses too, so the rule covers every listing.
- **Sold, On Hold, Withdrawn and Expired listings: primary photo only.** Every secondary photo is excluded (Exhibit A §16, Exhibit C notes). Under-contract and pending listings may show all photos.
- **Source attribution:** show the Georgia MLS name and logo on the pages that show listing data, plus a copyright notice naming GAMLS as the copyright holder (§§7, 10). Every listing, including thumbnails and cards, names the listing firm prominently, in type no smaller than the median listing-data text (§7).
- **Mandatory fields shown:** Listing Office, Listing ID, Status, Attribution Contact Phone and Attribution Contact Email. **Never shown:** Listing Agreement Type, Listing Contract Date, On Market Date, Expiration Date, Private Remarks, Showing Contact Name/Phone, Office Remarks and Showing Requirements (Exhibit C). Buyer-agency compensation is not shown at all (see below). Audit the RESO mapper and the listing page against this table.
- **Corrections:** a published way for GAMLS to report a wrong listing (a direct phone and a dedicated email), with the fix or removal within one business day (§6).
- **Traffic stats:** listing page views have to be made available to GAMLS on request (§9). Plan a simple per-listing view counter or an analytics export.
- **Unbiased sort:** once the user picks a sort, results are ranked organically (§12). This already holds, since there's no paid placement.
- **Anti-scraping:** commercially reasonable protection against data mining (Agreement §3): rate limiting and bot protection on the search/API routes.
- **DMCA:** the licensee registers a DMCA agent (§11). Done by the owner: see "As built" below.
- **Use restriction:** data is for consumers with a bona fide interest in buying, selling or renting, and may not be re-syndicated or redistributed without GAMLS's written consent (Exhibit A §§2, 5). This matters for any future plans to sell ads or leads.
- **Refresh:** at least daily, 7 days a week, including photos; use the most frequent schedule the source allows (Exhibit A §§1, 6). The 15-minute sync on Vercel Pro satisfies this.
- **Feed access:** RETS credentials within 5 business days. Bridge Web API (RESO) access requires the paid RETS subscription (§20). The site's provider targets RESO Web API (Bridge).

### As built (mobile branch)

Implemented as described in ARCHITECTURE.md → "Georgia MLS display rules": hidden statuses
(`idx_hidden`, `publicListing()`), primary photo only, the Georgia MLS name and copyright
notice, listing-firm attribution everywhere, the Exhibit C fields (and the mapper audit),
`/listing-corrections`, per-listing page views with an admin CSV export, the Postgres-backed
rate limiter in `proxy.ts`, and the unbiased-sort tests.

Owner decisions since, now built:

- **Official Georgia MLS logo.** The GAMLS IDX logo supplied by Georgia MLS is
  `public/brand/gamls_idx.png`, set in `site.mls.logo`; every `MlsAttribution` (footer,
  `/homes`, feed listing pages, `/listing-corrections`) shows it 24 px tall, on a white chip in
  dark mode. Every feed card, area-guide tile and map popup carries `MlsCredit` (logo at 24 px,
  "© <year> Georgia MLS"). The IDX disclaimer is "© <year> Georgia MLS. All rights reserved.
  Information is deemed reliable but is not guaranteed. IDX information is provided exclusively
  for consumers' personal, non-commercial use, that it may not be used for any purpose other
  than to identify prospective properties consumers may be interested in purchasing, and that
  the data is deemed reliable but is not guaranteed accurate by GAMLS. Last updated <date> ET",
  computed by `mlsDisclaimer()` (`src/lib/mls-copyright.ts`) from the gamls last sync; the
  stored gamls `data_sources.disclaimer` text is never shown. Only sources with an active
  listing get a footer disclaimer.
- **The firm's own listings follow the status rule too.** Coming Soon, Withdrawn, Expired and
  Canceled listings entered in the dashboard are hidden from the public like feed ones
  (`drizzle/0011_hide_all_hidden_statuses.sql` drops `from_feed and` from `idx_hidden`). There
  is no separate On Hold status: the mapper stores it as `withdrawn`, so it is hidden already.
  Staff still see and manage these listings in the dashboard. Undo: a migration restoring
  `from_feed and` in the column (and `isIdxHidden`).
- **DMCA designated agent (§11).** Registered by Adams Realty with the U.S. Copyright Office:
  Andrea A. Anderegg for Adams Realty, Inc., registration DMCA-1081724, effective 2026-10-02,
  (850) 572-3287, contracts.adamsrealty@gmail.com, mail to the office (69 Mill Street,
  Royston, GA 30662). The details are `site.dmca` in `src/config/site.ts`; the public notice
  is `/terms#copyright` ("Copyright complaints (DMCA)", with what a notice must include under
  17 U.S.C. §512(c)(3)), linked from every page's footer.

- **No buyer-broker compensation (GAMLS Rules & Regulations Art. V).** Buyer-agency
  compensation, compensation comments and Variable Compensation (no longer in the May 2025
  Exhibit C) are removed from every public page and payload: public queries don't select them
  (`src/lib/listings/public-fields.ts`). The columns, mapper and sync are unchanged; no staff
  dashboard view shows them.
- **Listing office when the feed sends none.** gamls2 sends ListOfficeName empty, so every
  display uses `listingOfficeLabel()`: feed ListOfficeName → the firm (its own listings) →
  "MLS Office ID <id>". Resolving names via the feed's Office resource is a planned follow-up.

Still with the owner: a dedicated corrections email if wanted, and confirming the feed's field
names. HANDOFF.md section 6 lists these.
