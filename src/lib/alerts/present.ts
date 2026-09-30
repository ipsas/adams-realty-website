import { site } from "@/config/site";
import { absoluteUrl, type BadgeTone, type EmailListing } from "@/lib/email-templates";
import { formatCityLine, formatPrice, formatStreet, statusLabel } from "@/lib/format";
import { isBareLand, landFacts } from "@/lib/listings/land";

/**
 * Turns alert query results into email rows. Pure — unit-tested without a
 * database.
 */

type Status =
  | "coming_soon"
  | "active"
  | "active_under_contract"
  | "pending"
  | "closed"
  | "withdrawn"
  | "expired"
  | "canceled";

/** The listing columns alert emails need (see `alertListingColumns`). */
export type AlertListing = {
  id: string;
  slug: string;
  status: Status;
  transactionType: "sale" | "rent";
  listPrice: number;
  closePrice: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  livingAreaSqft: number | null;
  /** For land: "Land · 12.5 acres" instead of beds and baths. */
  propertyType?: string;
  lotSizeSqft?: number | null;
  addressLine1: string;
  unitNumber: string | null;
  city: string;
  state: string;
  postalCode: string;
  hideAddress: boolean;
  primaryPhotoUrl: string | null;
  listOfficeName: string | null;
  isCompanyListing: boolean;
};

type Badge = { label: string; tone: BadgeTone };

const money = (n: number, rent: boolean) => `${formatPrice(n)}${rent ? "/mo" : ""}`;

export function toEmailListing(
  l: AlertListing,
  extra: { badge?: Badge; notes?: string[] } = {},
): EmailListing {
  const sold = l.status === "closed";
  const office = l.listOfficeName ?? (l.isCompanyListing ? site.name : null);
  return {
    href: absoluteUrl(`/homes/${l.slug}`),
    photoUrl: l.primaryPhotoUrl,
    price: sold && l.closePrice ? l.closePrice : l.listPrice,
    priceSuffix: l.transactionType === "rent" ? "/mo" : undefined,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    livingAreaSqft: l.livingAreaSqft,
    landFacts:
      l.propertyType && isBareLand({ ...l, propertyType: l.propertyType })
        ? landFacts({ ...l, propertyType: l.propertyType })
        : null,
    street: formatStreet(l),
    cityLine: formatCityLine(l),
    attribution: office ? `Listed by ${office}` : null,
    ...extra,
  };
}

/** "Price cut $15,000" badge + "Was $500,000" note, or nothing if the price didn't actually drop. */
export function priceCutDetails(
  wasPrice: number | null,
  l: Pick<AlertListing, "listPrice" | "transactionType">,
): { badge?: Badge; notes?: string[] } {
  if (wasPrice === null || wasPrice <= l.listPrice) return {};
  const rent = l.transactionType === "rent";
  return {
    badge: {
      label: `${rent ? "Rent drop" : "Price cut"} ${money(wasPrice - l.listPrice, false)}`,
      tone: "clay",
    },
    notes: [`Was ${money(wasPrice, rent)}`],
  };
}

/**
 * How many new listings and price cuts to show when an email holds at most
 * `cap` rows: new listings first, but price cuts keep up to `reserve` slots.
 */
export function allocateRows(
  newCount: number,
  cutCount: number,
  cap = 10,
  reserve = 3,
): { newShown: number; cutsShown: number } {
  const cutsShown = Math.min(cutCount, Math.max(cap - newCount, reserve), cap);
  return { newShown: Math.min(newCount, cap - cutsShown), cutsShown };
}

export type HomeEvent = {
  type: "listed" | "price_change" | "status_change" | "sold" | "relisted" | "removed";
  occurredAt: Date;
  price: number | null;
  previousPrice: number | null;
  fromStatus: Status | null;
  toStatus: Status | null;
};

const OFF_MARKET: Status[] = ["withdrawn", "expired", "canceled"];

function statusBadge(from: Status | null, to: Status, rent: boolean): Badge {
  if (to === "active") {
    return from === "coming_soon" || from === null
      ? { label: rent ? "Now for rent" : "Now for sale", tone: "brand" }
      : { label: "Back on market", tone: "brand" };
  }
  if (to === "active_under_contract" || to === "pending") {
    return { label: statusLabel(to), tone: "brass" };
  }
  if (OFF_MARKET.includes(to)) return { label: "Off market", tone: "ink" };
  return { label: statusLabel(to, rent ? "rent" : "sale"), tone: "brand" };
}

/**
 * Collapses one saved home's events in a window into a badge and short notes:
 * the net price change (first previous price → last price) and the latest
 * status. A sale outranks everything; changes that cancel out (e.g. pending
 * and back within the same window) are dropped. Null when nothing changed.
 */
export function summarizeHomeEvents(
  events: HomeEvent[],
  l: Pick<AlertListing, "listPrice" | "transactionType">,
): { badge: Badge; notes: string[] } | null {
  const sorted = [...events].sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  const rent = l.transactionType === "rent";
  const notes: string[] = [];
  let badge: Badge | undefined;

  const sold = sorted.findLast((e) => e.type === "sold");
  const statuses = sorted.filter((e) => e.type === "status_change" && e.toStatus !== null);
  const fromStatus = statuses[0]?.fromStatus ?? null;
  const toStatus = statuses.at(-1)?.toStatus ?? null;
  const relisted = sorted.some((e) => e.type === "relisted");

  if (sold) {
    badge = { label: rent ? "Rented" : "Sold", tone: "ink" };
    if (sold.price) notes.push(`${rent ? "Rented" : "Sold"} for ${money(sold.price, rent)}`);
    return { badge, notes };
  }

  if (toStatus && toStatus !== fromStatus) {
    badge = statusBadge(fromStatus, toStatus, rent);
    const to = statusLabel(toStatus, l.transactionType).toLowerCase();
    notes.push(
      fromStatus
        ? `Now ${to} (was ${statusLabel(fromStatus, l.transactionType).toLowerCase()})`
        : `Now ${to}`,
    );
  } else if (relisted) {
    badge = { label: "Back on market", tone: "brand" };
    notes.push(`Back on the market at ${money(l.listPrice, rent)}`);
  }

  const prices = sorted.filter(
    (e) => e.type === "price_change" && e.price !== null && e.previousPrice !== null,
  );
  if (prices.length) {
    const was = prices[0].previousPrice!;
    const now = prices.at(-1)!.price!;
    const diff = now - was;
    if (diff < 0) {
      const cut = `${rent ? "Rent drop" : "Price cut"} ${money(-diff, false)}`;
      if (!badge) {
        badge = { label: cut, tone: "clay" };
        notes.push(`Now ${money(now, rent)}, was ${money(was, rent)}`);
      } else {
        notes.push(`${cut} — now ${money(now, rent)}`);
      }
    } else if (diff > 0) {
      badge ??= { label: "Price increased", tone: "brass" };
      notes.push(`Price increased to ${money(now, rent)} (was ${money(was, rent)})`);
    }
  }

  return badge ? { badge, notes } : null;
}
