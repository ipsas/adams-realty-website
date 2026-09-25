export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Short, stable, URL-safe hash (FNV-1a, base36) so equal addresses stay distinct. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

/**
 * Address-first slugs read well in search results and shared links:
 * `/homes/1204-dogwood-ln-ne-atlanta-ga-30306-a1b2c3d`.
 */
export function listingSlug(l: {
  addressLine1: string;
  unitNumber?: string | null;
  city: string;
  state: string;
  postalCode: string;
  hideAddress?: boolean;
  sourceSlug: string;
  listingKey: string;
}): string {
  const address = l.hideAddress
    ? ""
    : [l.addressLine1, l.unitNumber ? `unit ${l.unitNumber}` : ""].filter(Boolean).join(" ");
  const base = slugify([address, l.city, l.state, l.postalCode].filter(Boolean).join(" "));
  return `${base}-${shortHash(`${l.sourceSlug}:${l.listingKey}`)}`;
}
