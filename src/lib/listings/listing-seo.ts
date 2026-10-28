/**
 * A listing page's title, meta description and BreadcrumbList JSON-LD (/homes/[slug]).
 * Pure: built only from the listing's own facts and the existing formatters, so every
 * "missing fact" case is unit-tested (listing-seo.test.ts).
 */
import { site } from "@/config/site";
import { placeHref } from "@/lib/areas/links";
import {
  formatBaths,
  formatNumber,
  formatPrice,
  formatStreet,
  isNullLike,
  listingMetaDescription,
  PROPERTY_TYPE_LABELS,
} from "@/lib/format";
import { redactAccessCodes } from "@/lib/listings/excluded-fields";
import { isMarketState, normalizeState } from "@/lib/state-name";

export type ListingSeoInput = {
  addressLine1: string;
  unitNumber?: string | null;
  hideAddress?: boolean;
  city: string;
  state: string;
  postalCode: string | null;
  listPrice: number;
  bedrooms: number | null;
  bathrooms: number | null;
  livingAreaSqft: number | null;
  propertyType: string;
  description: string | null;
};

/** Longest title kept whole; longer ones drop " | Adams Realty", then the ZIP. */
export const LISTING_TITLE_MAX = 65;

/** Remarks shorter than this make a thin description; the listing's facts are used instead. */
export const MIN_REMARKS_LENGTH = 70;

/**
 * "123 Main St, Royston, GA 30662 – $250,000 | Adams Realty". Over 65 characters it drops
 * the brand, then the ZIP; still over, it is kept whole rather than cut mid-word.
 * A hidden address reads as the page heading does ("Address withheld by seller").
 */
export function listingTitle(l: ListingSeoInput): string {
  const place = `${formatStreet(l)}, ${l.city}, ${normalizeState(l.state)}`;
  const zip = l.postalCode?.trim();
  const price = formatPrice(l.listPrice);
  const brand = ` | ${site.name}`;
  const candidates = [
    `${place}${zip ? ` ${zip}` : ""} – ${price}${brand}`,
    `${place}${zip ? ` ${zip}` : ""} – ${price}`,
    `${place} – ${price}`,
  ];
  return candidates.find((t) => t.length <= LISTING_TITLE_MAX) ?? candidates[2];
}

/**
 * The MLS remarks (access codes redacted) when they say enough; otherwise
 * "3 bed, 2 bath single-family home in Royston, GA – 1,850 sq ft, listed at $250,000.",
 * leaving out only the facts the listing lacks.
 */
export function listingDescription(l: ListingSeoInput): string {
  const remarks = l.description ? redactAccessCodes(l.description).trim() : "";
  if (remarks.length >= MIN_REMARKS_LENGTH) return listingMetaDescription(remarks);
  const type = (PROPERTY_TYPE_LABELS[l.propertyType] ?? PROPERTY_TYPE_LABELS.other).toLowerCase();
  const text = [
    l.bedrooms ? `${l.bedrooms} bed, ` : "",
    l.bathrooms ? `${formatBaths(l.bathrooms)} bath ` : "",
    `${type} in ${l.city}, ${normalizeState(l.state)}`,
    l.livingAreaSqft ? ` – ${formatNumber(l.livingAreaSqft)} sq ft` : "",
    `, listed at ${formatPrice(l.listPrice)}.`,
  ].join("");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export type ListingBreadcrumbInput = Pick<
  ListingSeoInput,
  "addressLine1" | "unitNumber" | "hideAddress" | "city" | "state"
> & { slug: string; county: string | null; neighborhood: string | null };

export type Breadcrumb = { name: string; href: string };

/**
 * The listing page's visible breadcrumb: Homes → the town (Georgia listings) → the
 * neighborhood (when it has one other than the town). The BreadcrumbList JSON-LD is
 * built from the same crumbs.
 */
export function listingBreadcrumbs(l: ListingBreadcrumbInput): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ name: "Homes", href: "/homes" }];
  if (!isMarketState(l.state)) return crumbs;
  crumbs.push({ name: l.city, href: placeHref(l.city, l.county) });
  // Rows synced before the mapper dropped placeholders can still hold "None".
  const neighborhood = isNullLike(l.neighborhood) ? null : l.neighborhood;
  if (neighborhood && neighborhood !== l.city) {
    crumbs.push({ name: neighborhood, href: placeHref(neighborhood, l.county) });
  }
  return crumbs;
}

export type BreadcrumbListJsonLd = {
  "@context": "https://schema.org";
  "@type": "BreadcrumbList";
  itemListElement: { "@type": "ListItem"; position: number; name: string; item: string }[];
};

/** The visible breadcrumb (`listingBreadcrumbs`) with absolute URLs, then the listing itself. */
export function listingBreadcrumbJsonLd(
  l: ListingBreadcrumbInput,
  baseUrl: string,
): BreadcrumbListJsonLd {
  const base = baseUrl.replace(/\/+$/, "");
  const crumbs = [
    ...listingBreadcrumbs(l).map((c) => ({ name: c.name, item: `${base}${c.href}` })),
    { name: formatStreet(l), item: `${base}/homes/${l.slug}` },
  ];
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({ "@type": "ListItem", position: i + 1, ...c })),
  };
}
