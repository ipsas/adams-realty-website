/**
 * Pure helpers for showing the firm's contact details (src/config/site.ts) on
 * company and legal pages. Kept free of React so they're unit-tested.
 */

type Address = { line1: string; city: string; state: string; postalCode: string };

/** `tel:` link in E.164 form for a US display number: "(404) 555-0142" → "tel:+14045550142". */
export function telHref(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return `tel:${digits}`;
}

/** `mailto:` link, optionally with a subject line so requests arrive pre-labeled. */
export function mailtoHref(email: string, subject?: string): string {
  return subject ? `mailto:${email}?subject=${encodeURIComponent(subject)}` : `mailto:${email}`;
}

/**
 * Display lines for an address. The site config allows an empty street line
 * (and ZIP) until the firm publishes an office, so blank parts are dropped:
 * `{ line1: "", city: "Atlanta", state: "GA" }` → `["Atlanta, GA"]`.
 */
export function addressLines(a: Address): string[] {
  const cityLine = [a.city.trim(), `${a.state} ${a.postalCode}`.trim()].filter(Boolean).join(", ");
  return [a.line1.trim(), cityLine].filter(Boolean);
}

export function hasStreetAddress(a: Address): boolean {
  return a.line1.trim().length > 0;
}

/** Map search link for a street address, or null when there's no street to find. */
export function directionsHref(a: Address): string | null {
  if (!hasStreetAddress(a)) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressLines(a).join(", "))}`;
}

/** "2026-09-25" → "September 25, 2026". Parsed at noon UTC so no time zone shifts the day. */
export function formatLongDate(isoDate: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`Expected YYYY-MM-DD, got ${isoDate}`);
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}
