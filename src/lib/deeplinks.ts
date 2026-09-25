/**
 * Hrefs that hand off to the phone's own apps: dialer, messages, mail and
 * maps. Pure, so the same links render on the server and the client.
 */

/**
 * "+14045550142" for a US/NANP number written any common way ("(404) 555-0142",
 * "404.555.0142 ext 12", "+1 404 555 0142"); international "+" numbers pass
 * through. Null when there's no dialable number.
 */
export function toE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const main = phone.split(/\s*(?:x|ext\.?|extension|#)\s*\d*\s*$/i)[0];
  const digits = main.replace(/\D/g, "");
  if (main.trim().startsWith("+") && !digits.startsWith("1")) {
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  // NANP: area code and exchange can't start with 0 or 1.
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(national) ? `+1${national}` : null;
}

/** "tel:+14045550142", or null when the number isn't dialable (hide the button). */
export function telHref(phone: string | null | undefined): string | null {
  const e164 = toE164(phone);
  return e164 ? `tel:${e164}` : null;
}

/**
 * "sms:+14045550142?&body=…". The "?&body=" form is the one both iOS and
 * Android Messages read.
 */
export function smsHref(phone: string | null | undefined, body?: string): string | null {
  const e164 = toE164(phone);
  if (!e164) return null;
  return body ? `sms:${e164}?&body=${encodeURIComponent(body)}` : `sms:${e164}`;
}

/** mailto with %20-encoded subject and body (mail apps show "+" literally). */
export function mailtoHref(email: string, opts: { subject?: string; body?: string } = {}): string {
  const params = [
    opts.subject && `subject=${encodeURIComponent(opts.subject)}`,
    opts.body && `body=${encodeURIComponent(opts.body)}`,
  ].filter(Boolean);
  return `mailto:${encodeURI(email.trim())}${params.length ? `?${params.join("&")}` : ""}`;
}

export type DirectionsHrefs = {
  /** Apple Maps (iOS, iPadOS, macOS). */
  apple: string;
  /** Google Maps (everything else); opens the app when installed. */
  google: string;
  /** Google Street View at the coordinates; null without them. */
  streetView: string | null;
};

/**
 * Driving directions from the device's current location, and Street View.
 * Null when the seller suppressed the address (IDX) or there is no location.
 * Prefers the address as the destination (what Maps shows); falls back to coordinates.
 */
export function directionsHrefs(l: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  address: string | null | undefined;
  hideAddress?: boolean | null;
}): DirectionsHrefs | null {
  if (l.hideAddress) return null;
  const hasCoords =
    typeof l.lat === "number" &&
    typeof l.lng === "number" &&
    Number.isFinite(l.lat) &&
    Number.isFinite(l.lng);
  const coords = hasCoords ? `${l.lat},${l.lng}` : null;
  const destination = l.address?.trim() || coords;
  if (!destination) return null;
  const d = encodeURIComponent(destination);
  return {
    apple: `https://maps.apple.com/?daddr=${d}&dirflg=d`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${d}&travelmode=driving`,
    streetView: coords
      ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${encodeURIComponent(coords)}`
      : null,
  };
}

/** iPhone, iPad (including iPadOS's desktop-class "Macintosh" UA) and Mac. */
export function isApplePlatform(ua: string | null | undefined): boolean {
  return !!ua && /\b(iPhone|iPad|iPod|Macintosh)\b/.test(ua);
}
