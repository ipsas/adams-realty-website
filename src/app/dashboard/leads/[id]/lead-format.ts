import { site } from "@/config/site";
import { formatStreet } from "@/lib/format";

/** Display helpers for the lead detail page and the CSV export. Pure, unit-tested. */

export const LEAD_TYPE_LABELS: Record<string, string> = {
  tour: "Tour request",
  question: "Question",
  offer: "Offer",
  valuation: "Home valuation",
  general: "General inquiry",
};

/** `inquiries.source`: the page the lead form was on. */
export const LEAD_SOURCE_LABELS: Record<string, string> = {
  listing: "Property page",
  sell: "Sell / home value page",
  agent: "Agent profile",
  contact: "Contact page",
};

export const TOUR_TYPE_LABELS: Record<string, string> = {
  in_person: "In person",
  video: "Video chat",
};

/** Drops an extension ("x12", "ext. 12") and keeps the dialable part. */
function dialable(phone: string): string | null {
  const main = phone.split(/\s*(?:x|ext\.?|extension)\s*\d/i)[0];
  const digits = main.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (main.trim().startsWith("+")) return `+${digits}`;
  // Leads come from US forms: 10 digits (or 1 + 10) are North American numbers.
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return digits;
}

export function telHref(phone: string | null | undefined): string | null {
  const n = phone ? dialable(phone) : null;
  return n ? `tel:${n}` : null;
}

export function smsHref(phone: string | null | undefined): string | null {
  const n = phone ? dialable(phone) : null;
  return n ? `sms:${n}` : null;
}

/** RFC 6068 mailto: spaces as %20 (not "+") and CRLF line breaks in the body. */
export function mailtoHref(email: string, opts: { subject?: string; body?: string } = {}): string {
  const query = [
    opts.subject && `subject=${encodeURIComponent(opts.subject)}`,
    opts.body && `body=${encodeURIComponent(opts.body.replace(/\r?\n/g, "\r\n"))}`,
  ]
    .filter(Boolean)
    .join("&");
  return `mailto:${encodeURIComponent(email).replace(/%40/g, "@")}${query ? `?${query}` : ""}`;
}

type HomeLike = {
  addressLine1: string;
  unitNumber?: string | null;
  city: string;
  state: string;
  postalCode: string;
  hideAddress?: boolean;
};

/** "123 Oak St, Royston" — or "the home in Royston" when the seller withheld the address. */
export function homeLabel(home: HomeLike): string {
  return home.hideAddress ? `the home in ${home.city}` : `${formatStreet(home)}, ${home.city}`;
}

/** Subject line for a follow-up email, naming the home when there is one. */
export function followUpSubject(lead: { type: string; listing: HomeLike | null }): string {
  const home = lead.listing ? homeLabel(lead.listing) : null;
  if (home) {
    if (lead.type === "tour") return `Your tour of ${home}`;
    if (lead.type === "offer") return `Your offer on ${home}`;
    return `Your question about ${home}`;
  }
  if (lead.type === "valuation") return "Your home valuation request";
  return `Your message to ${site.name}`;
}

/** Greeting that starts a follow-up email: "Hi Avery,". */
export function followUpGreeting(name: string): string {
  const first = name.trim().split(/\s+/)[0];
  return first ? `Hi ${first},\n\n` : "Hi,\n\n";
}

/** "Sat, Sep 26 · 11:00 AM EDT" in the market's time zone (year added when it isn't `now`'s). */
export function formatLeadDateTime(
  d: Date,
  now: Date = new Date(),
  timeZone: string = site.market.timeZone,
): string {
  const year = (x: Date) =>
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric" }).format(x);
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: year(d) === year(now) ? undefined : "numeric",
    timeZone,
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone,
  });
  return `${day} · ${time}`;
}

/**
 * The path a lead form was submitted from, taken from the saved Referer header.
 * Shown as plain text only: the header is visitor-controlled.
 */
export function refererPath(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    const path = `${url.pathname}${url.search}`;
    return path.length > 80 ? `${path.slice(0, 79)}…` : path;
  } catch {
    return null;
  }
}
