import { telHref } from "@/components/content/contact";
import { site } from "@/config/site";

/** A phone number as shown, and its tap-to-call link. */
export type PhoneLink = { text: string; href: string };

/**
 * Georgia law: a listing display shows the listing firm and its registered office phone
 * as primary. On the firm's own listings (as listingOfficeLabel decides: isCompanyListing,
 * or a manual listing, `fromFeed: false`), that's the office phone; then, smaller, the
 * broker's cell and the listing's own attribution phone when it is a third number (shown
 * today, so never dropped). Other brokerages' listings get null: the feed has no
 * listing-office phone, and an Adams number never shows on their listings.
 */
export function firmListingPhones(
  l: { isCompanyListing?: boolean | null; fromFeed?: boolean | null },
  contactPhone?: string | null,
): { office: PhoneLink; secondary: PhoneLink[] } | null {
  if (!(l.isCompanyListing || l.fromFeed === false)) return null;
  const firstName = site.broker.name.split(" ")[0];
  const secondary = [
    { text: `${firstName}'s cell ${site.broker.cell}`, href: telHref(site.broker.cell) },
  ];
  const extra = contactPhone?.trim();
  if (extra && ![site.phone, site.broker.cell].some((p) => digits(p) === digits(extra))) {
    secondary.push({ text: extra, href: telHref(extra) });
  }
  return { office: { text: site.phone, href: telHref(site.phone) }, secondary };
}

/** The 10-digit US number: "1-706-246-0053" and "(706) 246-0053" match. */
function digits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
}
