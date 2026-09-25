## Georgia MLS license compliance (from the IDX/Vendor Data License Agreement, v. Aug 1 2023, Exhibits A–C)

Required before real feed data goes public. This belongs to GA-A, or to its own small step after it.

- **No public display of Coming Soon, Expired, On Hold or Withdrawn listings** from the feed (Exhibit A §17). Today the site shows `coming_soon` in search, cards, map and listing pages. For MLS-sourced rows, exclude it (the firm's own manually entered listings are a separate question for the owner).
- **Sold, On Hold, Withdrawn and Expired listings: primary photo only.** Every secondary photo is excluded (Exhibit A §16, Exhibit C notes). Under-contract and pending listings may show all photos.
- **Source attribution:** show the Georgia MLS name and logo on the pages that show listing data, plus a copyright notice naming GAMLS as the copyright holder (§§7, 10). Every listing, including thumbnails and cards, names the listing firm prominently, in type no smaller than the median listing-data text (§7).
- **Mandatory fields shown:** Listing Office, Listing ID, Status, Variable Compensation, Attribution Contact Phone and Attribution Contact Email. **Never shown:** Listing Agreement Type, Listing Contract Date, On Market Date, Expiration Date, Private Remarks, Showing Contact Name/Phone, Office Remarks and Showing Requirements (Exhibit C). If buyer-agency compensation is shown, Compensation Comments are shown with it. Audit the RESO mapper and the listing page against this table.
- **Corrections:** a published way for GAMLS to report a wrong listing (a direct phone and a dedicated email), with the fix or removal within one business day (§6).
- **Traffic stats:** listing page views have to be made available to GAMLS on request (§9). Plan a simple per-listing view counter or an analytics export.
- **Unbiased sort:** once the user picks a sort, results are ranked organically (§12). This already holds, since there's no paid placement.
- **Anti-scraping:** commercially reasonable protection against data mining (Agreement §3): rate limiting and bot protection on the search/API routes.
- **DMCA:** the licensee registers a DMCA agent (§11). This is the owner's step: copyright.gov/dmca-directory.
- **Use restriction:** data is for consumers with a bona fide interest in buying, selling or renting, and may not be re-syndicated or redistributed without GAMLS's written consent (Exhibit A §§2, 5). This matters for any future plans to sell ads or leads.
- **Refresh:** at least daily, 7 days a week, including photos; use the most frequent schedule the source allows (Exhibit A §§1, 6). The 15-minute sync on Vercel Pro satisfies this.
- **Feed access:** RETS credentials within 5 business days. Bridge Web API (RESO) access requires the paid RETS subscription (§20). The site's provider targets RESO Web API (Bridge).
